import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import {
  buildPaymentJournal,
  round4,
  type PaymentJournalLine,
} from "./build-payment-journal.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  paymentId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

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

    // Cash vs applied (base ccy). When applied < cash the remainder is new
    // on-account credit; when applied > cash the excess must be funded by the
    // party's existing on-account credit (validated under lock inside the
    // commit transaction below, where prior posted payments are serialized).
    const totalAppliedBase = applications.data.reduce(
      (sum, a) => sum + Number(a.appliedAmount) * Number(a.paymentExchangeRate),
      0
    );
    const paymentTotalBase = Number(payment.data.totalAmount) * Number(payment.data.exchangeRate);
    const overAppliedBase = round4(totalAppliedBase - paymentTotalBase);

    // --------------------------------------------------------------
    // Build journal lines (in base currency)
    // --------------------------------------------------------------
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    const journalLineInserts: PaymentJournalLine[] = [];
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

      // Build the balanced double-entry. Account-id resolution, the per-
      // application control/discount/write-off lines, the on-account-credit
      // line, the single FX plug, and the balance self-check all live in the
      // pure `buildPaymentJournal` so they are unit-tested (post-payment.test.ts).
      const { lines } = buildPaymentJournal({
        paymentId,
        companyId,
        isReceipt,
        totalAmount: Number(payment.data.totalAmount),
        exchangeRate: Number(payment.data.exchangeRate),
        bankAccount: payment.data.bankAccount,
        journalLineReference,
        applications: applications.data.map((a) => ({
          salesInvoiceId: a.salesInvoiceId,
          purchaseInvoiceId: a.purchaseInvoiceId,
          appliedAmount: Number(a.appliedAmount),
          discountAmount: Number(a.discountAmount),
          writeOffAmount: Number(a.writeOffAmount),
          invoiceExchangeRate: Number(a.invoiceExchangeRate),
          paymentExchangeRate: Number(a.paymentExchangeRate),
        })),
        accounts: {
          controlAccountId: isReceipt
            ? ad.receivablesAccount
            : ad.payablesAccount,
          discountAccountId: isReceipt
            ? ad.customerPaymentDiscountAccount
            : ad.supplierPaymentDiscountAccount,
          writeOffAccountId: isReceipt
            ? ad.customerWriteOffAccount
            : ad.supplierWriteOffAccount,
          fxGainAccountId: ad.realizedExchangeGainAccount,
          fxLossAccountId: ad.realizedExchangeLossAccount,
        },
      });
      journalLineInserts.push(...lines);
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
      // The stored base "totalAmount" is deprecated (always 0 for invoices
      // posted after migration 20260604120000); the live total lives in the
      // salesInvoices/purchaseInvoices views. We can't lock a view (it joins +
      // aggregates), so we lock the base row FOR UPDATE — which serializes
      // concurrent posts and gives the raw posting status/party — and read the
      // live total from the view separately. Status MUST come from the base
      // row, not the view: the view derives 'Partially Paid'/'Paid', which
      // would wrongly fail the activeStatus check on a partially-settled
      // invoice.
      if (isReceipt && salesInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("salesInvoice")
          .select(["id", "status", "customerId"])
          .where("id", "in", salesInvoiceIds)
          .forUpdate()
          .execute();
        const totals = await trx
          .selectFrom("salesInvoices")
          .select(["id", "totalAmount"])
          .where("id", "in", salesInvoiceIds)
          .execute();
        const totalById = new Map(
          totals.map((t) => [t.id, Number(t.totalAmount)])
        );
        for (const r of rows) {
          invoiceById.set(r.id, {
            status: r.status as string,
            totalAmount: totalById.get(r.id) ?? 0,
            partyId: r.customerId,
          });
        }
      }
      if (!isReceipt && purchaseInvoiceIds.length > 0) {
        const rows = await trx
          .selectFrom("purchaseInvoice")
          .select(["id", "status", "supplierId"])
          .where("id", "in", purchaseInvoiceIds)
          .forUpdate()
          .execute();
        const totals = await trx
          .selectFrom("purchaseInvoices")
          .select(["id", "totalAmount"])
          .where("id", "in", purchaseInvoiceIds)
          .execute();
        const totalById = new Map(
          totals.map((t) => [t.id, Number(t.totalAmount)])
        );
        for (const r of rows) {
          invoiceById.set(r.id, {
            status: r.status as string,
            totalAmount: totalById.get(r.id) ?? 0,
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

      // When this payment applies more than its cash, the excess draws down the
      // party's available on-account credit — the net unapplied cash left on
      // their OTHER posted payments. Lock those payments FOR UPDATE so two
      // concurrent credit-consuming posts can't both spend the same credit.
      if (overAppliedBase > 0.0001) {
        const postedPayments = await (isReceipt
          ? trx
              .selectFrom("payment")
              .select(["id", "totalAmount", "exchangeRate"])
              .where("companyId", "=", companyId)
              .where("status", "=", "Posted")
              .where("customerId", "=", paymentPartyId)
              .forUpdate()
              .execute()
          : trx
              .selectFrom("payment")
              .select(["id", "totalAmount", "exchangeRate"])
              .where("companyId", "=", companyId)
              .where("status", "=", "Posted")
              .where("supplierId", "=", paymentPartyId)
              .forUpdate()
              .execute());

        let availableCreditBase = 0;
        if (postedPayments.length > 0) {
          const postedIds = postedPayments.map((p) => p.id);
          const priorApps = await trx
            .selectFrom("paymentApplication")
            .select(["paymentId", "appliedAmount", "paymentExchangeRate"])
            .where("paymentId", "in", postedIds)
            .execute();
          const appliedBaseByPayment = new Map<string, number>();
          for (const a of priorApps) {
            appliedBaseByPayment.set(
              a.paymentId,
              (appliedBaseByPayment.get(a.paymentId) ?? 0) +
                Number(a.appliedAmount) * Number(a.paymentExchangeRate)
            );
          }
          for (const p of postedPayments) {
            availableCreditBase +=
              Number(p.totalAmount) * Number(p.exchangeRate) -
              (appliedBaseByPayment.get(p.id) ?? 0);
          }
        }

        if (overAppliedBase > round4(availableCreditBase) + 0.0001) {
          throw new Error(
            `Applied exceeds payment cash by ${overAppliedBase} in base currency, but only ${round4(availableCreditBase)} of on-account credit is available for this ${isReceipt ? "customer" : "supplier"}`
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
