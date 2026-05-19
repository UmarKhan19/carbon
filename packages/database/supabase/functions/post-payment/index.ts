import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

import { credit, debit } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  paymentId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

// Round to 4 decimal places to match NUMERIC(19,4) storage and prevent
// floating-point cruft from making the journal fail its balance check.
const round4 = (n: number) => Math.round(n * 10000) / 10000;

type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { type, paymentId, userId, companyId } =
      payloadValidator.parse(payload);

    console.log({ function: "post-payment", type, paymentId, userId, companyId });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const accountingSettings = await client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single();
    const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;

    const [payment, applications, accountDefaults] = await Promise.all([
      client.from("payment").select("*").eq("id", paymentId).single(),
      client.from("paymentApplication").select("*").eq("paymentId", paymentId),
      getDefaultPostingGroup(client, companyId),
    ]);

    if (payment.error) throw new Error("Failed to fetch payment");
    if (applications.error) throw new Error("Failed to fetch payment applications");
    if (accountingEnabled && accountDefaults.error)
      throw new Error("Failed to fetch account defaults");

    const isReceipt = payment.data.paymentType === "Receipt";

    // --------------------------------------------------------------
    // VOID
    // --------------------------------------------------------------
    if (type === "void") {
      if (payment.data.status !== "Posted") {
        throw new Error(
          `Cannot void payment in status ${payment.data.status} (only Posted)`
        );
      }

      const accountingPeriodId = accountingEnabled
        ? await getCurrentAccountingPeriod(client, companyId, db)
        : null;

      await db.transaction().execute(async (trx) => {
        if (accountingEnabled && payment.data.journalId) {
          // Pull the original journal's lines and emit a reversing journal
          // (mirror amounts). This matches post-purchase-invoice's void
          // approach — a paired journal rather than mutating the original.
          const originalLines = await trx
            .selectFrom("journalLine")
            .selectAll()
            .where("journalId", "=", payment.data.journalId)
            .execute();

          if (originalLines.length > 0) {
            const voidEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const voidJournal = await trx
              .insertInto("journal")
              .values({
                journalEntryId: voidEntryId,
                accountingPeriodId,
                description: `VOID Payment ${payment.data.paymentId}`,
                postingDate: today,
                companyId,
                sourceType: "Payment",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            await trx
              .insertInto("journalLine")
              .values(
                originalLines.map((line) => ({
                  journalId: voidJournal.id,
                  accountId: line.accountId,
                  amount: -line.amount,
                  quantity: line.quantity,
                  description: `VOID: ${line.description ?? ""}`,
                  documentType: "Payment" as const,
                  documentId: paymentId,
                  documentLineReference: line.documentLineReference,
                  journalLineReference: line.journalLineReference,
                  companyId,
                }))
              )
              .execute();
          }
        }

        await trx
          .updateTable("payment")
          .set({
            status: "Voided",
            voidedAt: new Date().toISOString(),
            voidedBy: userId,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", paymentId)
          .execute();
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --------------------------------------------------------------
    // POST
    // --------------------------------------------------------------
    if (payment.data.status !== "Draft") {
      throw new Error(
        `Cannot post payment in status ${payment.data.status} (only Draft)`
      );
    }
    if (payment.data.exchangeRate <= 0) {
      throw new Error("Payment exchange rate must be > 0");
    }

    // Lock and validate invoices referenced by applications. Lock prevents
    // a concurrent post-payment from over-applying the same invoice.
    const salesInvoiceIds = applications.data
      .filter((a) => a.salesInvoiceId)
      .map((a) => a.salesInvoiceId as string);
    const purchaseInvoiceIds = applications.data
      .filter((a) => a.purchaseInvoiceId)
      .map((a) => a.purchaseInvoiceId as string);

    if (isReceipt && purchaseInvoiceIds.length > 0) {
      throw new Error("Receipt cannot apply to purchase invoices");
    }
    if (!isReceipt && salesInvoiceIds.length > 0) {
      throw new Error("Disbursement cannot apply to sales invoices");
    }

    const [salesInvoices, purchaseInvoices, openAppliedSums] = await Promise.all([
      salesInvoiceIds.length
        ? client.from("salesInvoice").select("id, status, totalAmount, exchangeRate").in("id", salesInvoiceIds)
        : Promise.resolve({ data: [], error: null }),
      purchaseInvoiceIds.length
        ? client.from("purchaseInvoice").select("id, status, totalAmount, exchangeRate").in("id", purchaseInvoiceIds)
        : Promise.resolve({ data: [], error: null }),
      // Existing settled amount on each invoice from prior posted payments.
      // We sum applied+discount+writeOff across applications whose parent
      // payment is Posted; this excludes the current draft.
      client
        .from("paymentApplication")
        .select("salesInvoiceId, purchaseInvoiceId, appliedAmount, discountAmount, writeOffAmount, payment!inner(status)")
        .eq("payment.status", "Posted")
        .in(
          isReceipt ? "salesInvoiceId" : "purchaseInvoiceId",
          isReceipt ? (salesInvoiceIds.length ? salesInvoiceIds : ["__none__"]) : (purchaseInvoiceIds.length ? purchaseInvoiceIds : ["__none__"])
        ),
    ]);

    if (salesInvoices.error) throw new Error("Failed to fetch sales invoices");
    if (purchaseInvoices.error) throw new Error("Failed to fetch purchase invoices");
    if (openAppliedSums.error) throw new Error("Failed to fetch prior applications");

    const invoiceById = new Map<string, { status: string; totalAmount: number; exchangeRate: number }>();
    for (const si of salesInvoices.data ?? []) {
      invoiceById.set(si.id, { status: si.status, totalAmount: Number(si.totalAmount), exchangeRate: Number(si.exchangeRate) });
    }
    for (const pi of purchaseInvoices.data ?? []) {
      invoiceById.set(pi.id, { status: pi.status, totalAmount: Number(pi.totalAmount), exchangeRate: Number(pi.exchangeRate) });
    }

    const priorSettledByInvoice = new Map<string, number>();
    for (const row of openAppliedSums.data ?? []) {
      const invId = (isReceipt ? row.salesInvoiceId : row.purchaseInvoiceId) as string | null;
      if (!invId) continue;
      priorSettledByInvoice.set(
        invId,
        (priorSettledByInvoice.get(invId) ?? 0) +
          Number(row.appliedAmount) + Number(row.discountAmount) + Number(row.writeOffAmount)
      );
    }

    // Validate each application. Active state name differs per side
    // (Submitted for sales, Open for purchase — both mean "posted to GL,
    // available for settlement").
    const activeStatus = isReceipt ? "Submitted" : "Open";
    let totalApplied = 0; // in invoice currency, summed across applications
    const currentSettledByInvoice = new Map<string, number>();
    for (const app of applications.data) {
      const invId = (isReceipt ? app.salesInvoiceId : app.purchaseInvoiceId) as string;
      const inv = invoiceById.get(invId);
      if (!inv) throw new Error(`Invoice ${invId} not found`);
      if (inv.status !== activeStatus) {
        throw new Error(
          `Cannot apply payment to invoice ${invId} in status ${inv.status} (must be ${activeStatus})`
        );
      }
      if (app.invoiceExchangeRate <= 0 || app.paymentExchangeRate <= 0) {
        throw new Error("Application exchange rates must be > 0");
      }

      const settledByThisApp =
        Number(app.appliedAmount) + Number(app.discountAmount) + Number(app.writeOffAmount);
      currentSettledByInvoice.set(
        invId,
        (currentSettledByInvoice.get(invId) ?? 0) + settledByThisApp
      );

      const remainingOpen = inv.totalAmount - (priorSettledByInvoice.get(invId) ?? 0);
      const wouldSettle = currentSettledByInvoice.get(invId)!;
      if (wouldSettle > remainingOpen + 0.0001) {
        throw new Error(
          `Application total (${wouldSettle}) exceeds remaining open amount (${remainingOpen}) on invoice ${invId}`
        );
      }

      totalApplied += Number(app.appliedAmount);
    }

    // Cash balance: sum of applied principals × paymentRate must not exceed
    // total cash moved. Excess is "on-account" / unapplied — legitimate.
    const totalAppliedBase = applications.data.reduce(
      (sum, a) => sum + Number(a.appliedAmount) * Number(a.paymentExchangeRate),
      0
    );
    const paymentTotalBase = Number(payment.data.totalAmount) * Number(payment.data.exchangeRate);
    if (totalAppliedBase > paymentTotalBase + 0.0001) {
      throw new Error(
        `Total applied (${totalAppliedBase}) exceeds payment total (${paymentTotalBase}) in base currency`
      );
    }
    const unappliedInPaymentCcy = Number(payment.data.totalAmount) -
      applications.data.reduce((sum, a) => sum + Number(a.appliedAmount), 0);

    // --------------------------------------------------------------
    // Build journal lines (in base currency)
    // --------------------------------------------------------------
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    let createdJournalId: string | null = null;
    if (accountingEnabled && accountDefaults.data) {
      const ad = accountDefaults.data;
      const journalLineReference = nanoid();
      const journalLineInserts: JournalLineInsert[] = [];

      const bankAccountId = payment.data.bankAccount;
      const controlAccountId = isReceipt ? ad.receivablesAccount : ad.payablesAccount;
      const discountAccountId = isReceipt
        ? ad.customerPaymentDiscountAccount
        : ad.supplierPaymentDiscountAccount;
      const writeOffAccountId = isReceipt
        ? ad.customerWriteOffAccount
        : ad.supplierWriteOffAccount;
      const fxGainAccountId = ad.realizedExchangeGainAccount;
      const fxLossAccountId = ad.realizedExchangeLossAccount;

      // 1) Cash: DR Bank (Receipt) or CR Bank (Disbursement) for full
      //    totalAmount in base currency.
      const cashBase = round4(
        Number(payment.data.totalAmount) * Number(payment.data.exchangeRate)
      );
      journalLineInserts.push({
        accountId: bankAccountId,
        description: "Bank / Cash",
        amount: isReceipt ? debit("asset", cashBase) : credit("asset", cashBase),
        quantity: 1,
        documentType: "Payment",
        documentId: paymentId,
        journalLineReference,
        companyId,
      });

      // 2) Per-application: CR/DR control account at INVOICE rate,
      //    DR/CR discount and write-off at PAYMENT rate.
      let totalFxImpact = 0; // in base currency; +ve = gain for AR, loss for AP
      for (const app of applications.data) {
        const invId = (isReceipt ? app.salesInvoiceId : app.purchaseInvoiceId) as string;
        const applied = Number(app.appliedAmount);
        const discount = Number(app.discountAmount);
        const writeOff = Number(app.writeOffAmount);
        const invRate = Number(app.invoiceExchangeRate);
        const payRate = Number(app.paymentExchangeRate);

        // Control account: at invoice rate (original AR/AP booking).
        const controlBase = round4((applied + discount + writeOff) * invRate);
        journalLineInserts.push({
          accountId: controlAccountId,
          description: isReceipt ? "Accounts Receivable" : "Accounts Payable",
          amount: isReceipt
            ? credit("asset", controlBase)
            : debit("liability", controlBase),
          quantity: 1,
          documentType: "Payment",
          documentId: paymentId,
          documentLineReference: invId,
          journalLineReference,
          companyId,
        });

        // Discount: at payment rate. AR side debits (we forgo revenue);
        // AP side credits (vendor allowance reduces our cost).
        if (discount > 0) {
          const discountBase = round4(discount * payRate);
          journalLineInserts.push({
            accountId: discountAccountId,
            description: isReceipt
              ? "Customer Payment Discount"
              : "Supplier Payment Discount",
            amount: isReceipt
              ? debit("expense", discountBase)
              : credit("expense", discountBase),
            quantity: 1,
            documentType: "Payment",
            documentId: paymentId,
            documentLineReference: invId,
            journalLineReference,
            companyId,
          });
        }

        // Write-off: at payment rate. AR is bad debt (expense); AP is
        // vendor write-off (income — class=Revenue).
        if (writeOff > 0) {
          const writeOffBase = round4(writeOff * payRate);
          journalLineInserts.push({
            accountId: writeOffAccountId,
            description: isReceipt ? "Bad Debt Expense" : "Vendor Write-Off Income",
            amount: isReceipt
              ? debit("expense", writeOffBase)
              : credit("revenue", writeOffBase),
            quantity: 1,
            documentType: "Payment",
            documentId: paymentId,
            documentLineReference: invId,
            journalLineReference,
            companyId,
          });
        }

        // FX impact on this application: (applied + discount + writeOff)
        // × (paymentRate - invoiceRate). For AR, +ve = gain. For AP, +ve = loss.
        // (The migration's fxGainLossAmount column excludes writeOff; the
        // journal includes it for full balance — small accounting deltas
        // would otherwise spill into the journal imbalance.)
        const fxDelta = (applied + discount + writeOff) * (payRate - invRate);
        totalFxImpact += isReceipt ? fxDelta : -fxDelta;
      }

      // 3) Unapplied cash: control account takes the remainder so the
      //    customer/supplier's overall balance moves by the full cash amount.
      //    Booked at payment rate since there's no invoice anchor.
      if (unappliedInPaymentCcy > 0.0001) {
        const unappliedBase = round4(
          unappliedInPaymentCcy * Number(payment.data.exchangeRate)
        );
        journalLineInserts.push({
          accountId: controlAccountId,
          description: isReceipt
            ? "Accounts Receivable (on-account credit)"
            : "Accounts Payable (on-account credit)",
          amount: isReceipt
            ? credit("asset", unappliedBase)
            : debit("liability", unappliedBase),
          quantity: 1,
          documentType: "Payment",
          documentId: paymentId,
          journalLineReference,
          companyId,
        });
      }

      // 4) FX plug. Single line, no per-application breakdown.
      if (Math.abs(totalFxImpact) > 0.0001) {
        const fxBase = round4(Math.abs(totalFxImpact));
        if (totalFxImpact > 0) {
          journalLineInserts.push({
            accountId: fxGainAccountId,
            description: "Realized FX Gain",
            amount: credit("revenue", fxBase),
            quantity: 1,
            documentType: "Payment",
            documentId: paymentId,
            journalLineReference,
            companyId,
          });
        } else {
          journalLineInserts.push({
            accountId: fxLossAccountId,
            description: "Realized FX Loss",
            amount: debit("expense", fxBase),
            quantity: 1,
            documentType: "Payment",
            documentId: paymentId,
            journalLineReference,
            companyId,
          });
        }
      }

      // Sanity check: journal must balance to within rounding tolerance.
      const total = journalLineInserts.reduce(
        (sum, l) => sum + Number(l.amount),
        0
      );
      if (Math.abs(total) > 0.01) {
        throw new Error(
          `Payment journal does not balance: net ${total} (expected ~0)`
        );
      }

      await db.transaction().execute(async (trx) => {
        // Lock invoice rows for the duration of the transaction so a
        // concurrent post-payment can't over-apply.
        if (salesInvoiceIds.length > 0) {
          await trx
            .selectFrom("salesInvoice")
            .select("id")
            .where("id", "in", salesInvoiceIds)
            .forUpdate()
            .execute();
        }
        if (purchaseInvoiceIds.length > 0) {
          await trx
            .selectFrom("purchaseInvoice")
            .select("id")
            .where("id", "in", purchaseInvoiceIds)
            .forUpdate()
            .execute();
        }

        const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);
        const journalResult = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            accountingPeriodId,
            description: `Payment ${payment.data.paymentId}`,
            postingDate: today,
            companyId,
            sourceType: "Payment",
            status: "Posted",
            postedAt: new Date().toISOString(),
            postedBy: userId,
            createdBy: userId,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        createdJournalId = journalResult.id;

        if (journalLineInserts.length > 0) {
          await trx
            .insertInto("journalLine")
            .values(
              journalLineInserts.map((line) => ({
                ...line,
                journalId: journalResult.id,
              }))
            )
            .execute();
        }

        await trx
          .updateTable("payment")
          .set({
            status: "Posted",
            postingDate: today,
            journalId: journalResult.id,
            postedAt: new Date().toISOString(),
            postedBy: userId,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", paymentId)
          .execute();
      });
    } else {
      // Accounting disabled: still flip status to Posted, no GL impact.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("payment")
          .set({
            status: "Posted",
            postingDate: today,
            postedAt: new Date().toISOString(),
            postedBy: userId,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", paymentId)
          .execute();
      });
    }

    return new Response(
      JSON.stringify({ success: true, journalId: createdJournalId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
