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

            const voidLineResults = await trx
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
              .returning(["id"])
              .execute();

            // Carry the original lines' dimensions onto the reversing lines so
            // dimension-filtered balances net to zero after the void.
            const origDimensions = await trx
              .selectFrom("journalLineDimension")
              .select(["journalLineId", "dimensionId", "valueId"])
              .where(
                "journalLineId",
                "in",
                originalLines.map((l) => l.id)
              )
              .execute();
            if (origDimensions.length > 0) {
              const idxByOriginalId = new Map(
                originalLines.map((l, i) => [l.id, i])
              );
              await trx
                .insertInto("journalLineDimension")
                .values(
                  origDimensions.map((d) => ({
                    journalLineId:
                      voidLineResults[idxByOriginalId.get(d.journalLineId)!].id,
                    dimensionId: d.dimensionId,
                    valueId: d.valueId,
                    companyId,
                  }))
                )
                .execute();
            }
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

    // Invoice ids referenced by this payment's applications. The lock +
    // validation against invoice state (existence, counterparty, active
    // status, over-settlement cap) happens inside the commit transaction
    // below, NOT here — see the note on the application-level checks.
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

    // Application-level checks that need no invoice state. The invoice-
    // dependent checks run INSIDE the transaction below, after the invoice
    // rows are locked — otherwise two concurrent posts could both read the
    // same prior-settled total and both slip past the over-settlement cap.
    for (const app of applications.data) {
      if (app.invoiceExchangeRate <= 0 || app.paymentExchangeRate <= 0) {
        throw new Error("Application exchange rates must be > 0");
      }
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

    const journalLineInserts: JournalLineInsert[] = [];
    // Running balance in true debit(+)/credit(−) space. A balanced double
    // entry sums to ~0 here. (The stored `amount` is natural-balance signed —
    // credit("asset") is negative — so it does NOT sum to zero; we track the
    // debit/credit balance separately so we can self-check below.)
    let signedDebitTotal = 0;
    // Dimension applied to every journal line: the customer type (Receipt) or
    // supplier type (Disbursement), mirroring how invoice posting tags lines
    // so AR/AP can be reported by counterparty type. Resolved below.
    // Dimensions to tag on every payment journal line so AR/AP can be reported
    // by counterparty. We tag both the counterparty *type* (CustomerType /
    // SupplierType) and the specific counterparty *entity* (Customer / Supplier).
    const partyDimensions: { dimensionId: string; valueId: string }[] = [];

    if (accountingEnabled) {
      if (!accountDefaults.data) {
        throw new Error(
          "Accounting is enabled but this company has no account defaults configured"
        );
      }
      const ad = accountDefaults.data;
      const journalLineReference = nanoid();

      // Resolve the counterparty type + entity dimensions for this payment.
      const companyRecord = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      const companyGroupId = companyRecord.data?.companyGroupId ?? null;
      const partyId = isReceipt
        ? (payment.data.customerId as string | null)
        : (payment.data.supplierId as string | null);
      const typeEntityType = isReceipt ? "CustomerType" : "SupplierType";
      const entityEntityType = isReceipt ? "Customer" : "Supplier";
      if (companyGroupId && partyId) {
        const [partyRow, dimRows] = await Promise.all([
          isReceipt
            ? client
                .from("customer")
                .select("customerTypeId")
                .eq("id", partyId)
                .maybeSingle()
            : client
                .from("supplier")
                .select("supplierTypeId")
                .eq("id", partyId)
                .maybeSingle(),
          client
            .from("dimension")
            .select("id, entityType")
            .eq("companyGroupId", companyGroupId)
            .eq("active", true)
            .in("entityType", [typeEntityType, entityEntityType]),
        ]);
        const dimByEntityType = new Map<string, string>();
        for (const d of dimRows.data ?? []) {
          if (d.entityType) dimByEntityType.set(d.entityType, d.id);
        }
        // deno-lint-ignore no-explicit-any
        const party = partyRow.data as any;
        const partyTypeId = isReceipt
          ? (party?.customerTypeId ?? null)
          : (party?.supplierTypeId ?? null);
        const typeDimensionId = dimByEntityType.get(typeEntityType);
        if (typeDimensionId && partyTypeId) {
          partyDimensions.push({
            dimensionId: typeDimensionId,
            valueId: partyTypeId,
          });
        }
        const entityDimensionId = dimByEntityType.get(entityEntityType);
        if (entityDimensionId) {
          partyDimensions.push({
            dimensionId: entityDimensionId,
            valueId: partyId,
          });
        }
      }

      const controlAccountId = isReceipt
        ? ad.receivablesAccount
        : ad.payablesAccount;
      const discountAccountId = isReceipt
        ? ad.customerPaymentDiscountAccount
        : ad.supplierPaymentDiscountAccount;
      const writeOffAccountId = isReceipt
        ? ad.customerWriteOffAccount
        : ad.supplierWriteOffAccount;
      const fxGainAccountId = ad.realizedExchangeGainAccount;
      const fxLossAccountId = ad.realizedExchangeLossAccount;

      if (!controlAccountId) {
        throw new Error(
          `Missing ${isReceipt ? "receivables" : "payables"} account default; cannot post payment to GL`
        );
      }

      // Push a line and keep the debit/credit running balance in sync.
      const pushLine = (
        side: "debit" | "credit",
        accountType: "asset" | "liability" | "equity" | "revenue" | "expense",
        magnitude: number,
        fields: {
          accountId: string;
          description: string;
          documentLineReference?: string;
        }
      ) => {
        signedDebitTotal += side === "debit" ? magnitude : -magnitude;
        journalLineInserts.push({
          accountId: fields.accountId,
          description: fields.description,
          amount:
            side === "debit"
              ? debit(accountType, magnitude)
              : credit(accountType, magnitude),
          quantity: 1,
          documentType: "Payment",
          documentId: paymentId,
          documentLineReference: fields.documentLineReference,
          journalLineReference,
          companyId,
        });
      };

      // 1) Cash: DR Bank (Receipt) / CR Bank (Disbursement), full cash in base.
      const cashBase = round4(
        Number(payment.data.totalAmount) * Number(payment.data.exchangeRate)
      );
      pushLine(isReceipt ? "debit" : "credit", "asset", cashBase, {
        accountId: payment.data.bankAccount,
        description: "Bank / Cash",
      });

      // 2) Per application: control at INVOICE rate; discount / write-off at
      //    PAYMENT rate. FX is accumulated and plugged once below.
      let totalFxImpact = 0; // base ccy; +ve = gain for AR, loss for AP
      for (const app of applications.data) {
        const invId = (isReceipt
          ? app.salesInvoiceId
          : app.purchaseInvoiceId) as string;
        const applied = Number(app.appliedAmount);
        const discount = Number(app.discountAmount);
        const writeOff = Number(app.writeOffAmount);
        const invRate = Number(app.invoiceExchangeRate);
        const payRate = Number(app.paymentExchangeRate);

        // Control account: at invoice rate (mirrors the original AR/AP booking).
        pushLine(
          isReceipt ? "credit" : "debit",
          isReceipt ? "asset" : "liability",
          round4((applied + discount + writeOff) * invRate),
          {
            accountId: controlAccountId,
            description: isReceipt ? "Accounts Receivable" : "Accounts Payable",
            documentLineReference: invId,
          }
        );

        // Discount: at INVOICE rate (an invoice-currency relief, not cash, so
        // it carries no FX). AR debits (forgone revenue); AP credits (vendor
        // allowance reduces our cost).
        if (discount > 0) {
          if (!discountAccountId) {
            throw new Error(
              `Missing ${isReceipt ? "customer" : "supplier"} payment discount account default`
            );
          }
          pushLine(
            isReceipt ? "debit" : "credit",
            "expense",
            round4(discount * invRate),
            {
              accountId: discountAccountId,
              description: isReceipt
                ? "Customer Payment Discount"
                : "Supplier Payment Discount",
              documentLineReference: invId,
            }
          );
        }

        // Write-off: at INVOICE rate (an invoice-currency relief, not cash, so
        // it carries no FX). AR is bad debt (expense); AP is vendor write-off
        // (income — class=Revenue).
        if (writeOff > 0) {
          if (!writeOffAccountId) {
            throw new Error(
              `Missing ${isReceipt ? "customer" : "supplier"} write-off account default`
            );
          }
          pushLine(
            isReceipt ? "debit" : "credit",
            isReceipt ? "expense" : "revenue",
            round4(writeOff * invRate),
            {
              accountId: writeOffAccountId,
              description: isReceipt
                ? "Bad Debt Expense"
                : "Vendor Write-Off Income",
              documentLineReference: invId,
            }
          );
        }

        // Realized FX on the cash-settled principal only: applied × (paymentRate
        // − invoiceRate). Discount and write-off are invoice-currency reliefs
        // booked at the invoice rate above, so they carry no FX. For AR, +ve =
        // gain; for AP, +ve = loss. Matches the stored
        // paymentApplication.fxGainLossAmount so the subledger reconciles.
        totalFxImpact += (isReceipt ? 1 : -1) * applied * (payRate - invRate);
      }

      // 3) Unapplied cash → control account (no invoice anchor), payment rate.
      if (unappliedInPaymentCcy > 0.0001) {
        pushLine(
          isReceipt ? "credit" : "debit",
          isReceipt ? "asset" : "liability",
          round4(unappliedInPaymentCcy * Number(payment.data.exchangeRate)),
          {
            accountId: controlAccountId,
            description: isReceipt
              ? "Accounts Receivable (on-account credit)"
              : "Accounts Payable (on-account credit)",
          }
        );
      }

      // 4) FX plug (single line).
      if (Math.abs(totalFxImpact) > 0.0001) {
        const fxBase = round4(Math.abs(totalFxImpact));
        if (totalFxImpact > 0) {
          if (!fxGainAccountId) {
            throw new Error("Missing realized FX gain account default");
          }
          pushLine("credit", "revenue", fxBase, {
            accountId: fxGainAccountId,
            description: "Realized FX Gain",
          });
        } else {
          if (!fxLossAccountId) {
            throw new Error("Missing realized FX loss account default");
          }
          pushLine("debit", "expense", fxBase, {
            accountId: fxLossAccountId,
            description: "Realized FX Loss",
          });
        }
      }

      // Self-check: the entry must balance in true debit/credit space. The FX
      // plug (same formula as the stored fxGainLossAmount) should make this
      // ~0; a larger residual means a logic/rounding bug, so we refuse to post
      // rather than write an unbalanced journal to the GL.
      if (Math.abs(signedDebitTotal) > 0.01) {
        throw new Error(
          `Payment journal does not balance (off by ${round4(signedDebitTotal)} in base currency); refusing to post`
        );
      }
    }

    // --------------------------------------------------------------
    // Commit: lock + validate the invoices under the transaction, then post.
    // --------------------------------------------------------------
    const paymentPartyId = isReceipt
      ? payment.data.customerId
      : payment.data.supplierId;
    const activeStatus = isReceipt ? "Submitted" : "Open";

    let createdJournalId: string | null = null;
    await db.transaction().execute(async (trx) => {
      // Lock + read the target invoices in one shot. Holding the row locks for
      // the rest of the transaction serializes concurrent posts so the
      // over-settlement cap below can't be raced (TOCTOU).
      const invoiceById = new Map<
        string,
        { status: string; totalAmount: number; partyId: string | null }
      >();
      if (isReceipt && salesInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("salesInvoice")
          .select(["id", "status", "totalAmount", "customerId"])
          .where("id", "in", salesInvoiceIds)
          .forUpdate()
          .execute();
        for (const r of rows) {
          invoiceById.set(r.id, {
            status: r.status as string,
            totalAmount: Number(r.totalAmount),
            partyId: r.customerId,
          });
        }
      }
      if (!isReceipt && purchaseInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("purchaseInvoice")
          .select(["id", "status", "totalAmount", "supplierId"])
          .where("id", "in", purchaseInvoiceIds)
          .forUpdate()
          .execute();
        for (const r of rows) {
          invoiceById.set(r.id, {
            status: r.status as string,
            totalAmount: Number(r.totalAmount),
            partyId: r.supplierId,
          });
        }
      }

      // Prior settled from OTHER posted payments, read under the same lock.
      const priorSettledByInvoice = new Map<string, number>();
      if (isReceipt && salesInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("paymentApplication as pa")
          .innerJoin("payment as p", "p.id", "pa.paymentId")
          .select([
            "pa.salesInvoiceId as invId",
            "pa.appliedAmount",
            "pa.discountAmount",
            "pa.writeOffAmount",
          ])
          .where("p.status", "=", "Posted")
          .where("pa.salesInvoiceId", "in", salesInvoiceIds)
          .execute();
        for (const r of rows) {
          if (!r.invId) continue;
          priorSettledByInvoice.set(
            r.invId,
            (priorSettledByInvoice.get(r.invId) ?? 0) +
              Number(r.appliedAmount) +
              Number(r.discountAmount) +
              Number(r.writeOffAmount)
          );
        }
      } else if (!isReceipt && purchaseInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("paymentApplication as pa")
          .innerJoin("payment as p", "p.id", "pa.paymentId")
          .select([
            "pa.purchaseInvoiceId as invId",
            "pa.appliedAmount",
            "pa.discountAmount",
            "pa.writeOffAmount",
          ])
          .where("p.status", "=", "Posted")
          .where("pa.purchaseInvoiceId", "in", purchaseInvoiceIds)
          .execute();
        for (const r of rows) {
          if (!r.invId) continue;
          priorSettledByInvoice.set(
            r.invId,
            (priorSettledByInvoice.get(r.invId) ?? 0) +
              Number(r.appliedAmount) +
              Number(r.discountAmount) +
              Number(r.writeOffAmount)
          );
        }
      }

      // Validate each application against the locked invoice state.
      const currentSettledByInvoice = new Map<string, number>();
      for (const app of applications.data) {
        const invId = (isReceipt
          ? app.salesInvoiceId
          : app.purchaseInvoiceId) as string;
        const inv = invoiceById.get(invId);
        if (!inv) throw new Error(`Invoice ${invId} not found`);
        if (inv.partyId !== paymentPartyId) {
          throw new Error(
            `Invoice ${invId} belongs to a different ${isReceipt ? "customer" : "supplier"} than the payment`
          );
        }
        if (inv.status !== activeStatus) {
          throw new Error(
            `Cannot apply payment to invoice ${invId} in status ${inv.status} (must be ${activeStatus})`
          );
        }
        const settledByThisApp =
          Number(app.appliedAmount) +
          Number(app.discountAmount) +
          Number(app.writeOffAmount);
        currentSettledByInvoice.set(
          invId,
          (currentSettledByInvoice.get(invId) ?? 0) + settledByThisApp
        );
        const remainingOpen =
          inv.totalAmount - (priorSettledByInvoice.get(invId) ?? 0);
        const wouldSettle = currentSettledByInvoice.get(invId)!;
        if (wouldSettle > remainingOpen + 0.0001) {
          throw new Error(
            `Application total (${wouldSettle}) exceeds remaining open amount (${remainingOpen}) on invoice ${invId}`
          );
        }
      }

      // GL journal (only when accounting is enabled).
      let journalId: string | null = null;
      if (accountingEnabled) {
        const journalEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );
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
        journalId = journalResult.id;

        if (journalLineInserts.length > 0) {
          const journalLineResults = await trx
            .insertInto("journalLine")
            .values(
              journalLineInserts.map((line) => ({
                ...line,
                journalId: journalResult.id,
              }))
            )
            .returning(["id"])
            .execute();

          // Tag every line with the counterparty dimensions (type + entity).
          if (partyDimensions.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(
                journalLineResults.flatMap((jl) =>
                  partyDimensions.map((d) => ({
                    journalLineId: jl.id,
                    dimensionId: d.dimensionId,
                    valueId: d.valueId,
                    companyId,
                  }))
                )
              )
              .execute();
          }
        }
      }

      await trx
        .updateTable("payment")
        .set({
          status: "Posted",
          postingDate: today,
          journalId,
          postedAt: new Date().toISOString(),
          postedBy: userId,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        })
        .where("id", "=", paymentId)
        .execute();

      createdJournalId = journalId;
    });

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
