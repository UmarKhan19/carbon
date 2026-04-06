import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  invoiceId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  skipReceiptPost: z.boolean().optional(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { invoiceId, userId, companyId, skipReceiptPost } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-purchase-invoice",
      invoiceId,
      userId,
      skipReceiptPost,
    });
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const companyRecord = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;

    const [purchaseInvoice, purchaseInvoiceLines, purchaseInvoiceDelivery] =
      await Promise.all([
        client.from("purchaseInvoice").select("*").eq("id", invoiceId).single(),
        client
          .from("purchaseInvoiceLine")
          .select("*")
          .eq("invoiceId", invoiceId),
        client
          .from("purchaseInvoiceDelivery")
          .select("supplierShippingCost")
          .eq("id", invoiceId)
          .single(),
      ]);

    if (purchaseInvoice.error)
      throw new Error("Failed to fetch purchaseInvoice");
    if (purchaseInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");
    if (purchaseInvoiceDelivery.error)
      throw new Error("Failed to fetch purchase invoice delivery");

    const shippingCost =
      (purchaseInvoiceDelivery.data?.supplierShippingCost ?? 0) *
      (purchaseInvoice.data?.exchangeRate ?? 1);

    const totalLinesCost = purchaseInvoiceLines.data.reduce(
      (acc, invoiceLine) => {
        const lineCost =
          (invoiceLine.quantity ?? 0) * (invoiceLine.unitPrice ?? 0) +
          (invoiceLine.shippingCost ?? 0) +
          (invoiceLine.taxAmount ?? 0);
        return acc + lineCost;
      },
      0
    );

    const itemIds = purchaseInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
          acc.push(invoiceLine.itemId);
        }
        return acc;
      },
      []
    );

    const [items, itemCosts, purchaseOrderLines, supplier, dimensions] =
      await Promise.all([
        client
          .from("item")
          .select("id, itemTrackingType")
          .in("id", itemIds)
          .eq("companyId", companyId),
        client
          .from("itemCost")
          .select("itemId, itemPostingGroupId")
          .in("itemId", itemIds),
        client
          .from("purchaseOrderLine")
          .select("*")
          .in(
            "id",
            purchaseInvoiceLines.data.reduce<string[]>((acc, invoiceLine) => {
              if (
                invoiceLine.purchaseOrderLineId &&
                !acc.includes(invoiceLine.purchaseOrderLineId)
              ) {
                acc.push(invoiceLine.purchaseOrderLineId);
              }
              return acc;
            }, [])
          ),
        client
          .from("supplier")
          .select("*")
          .eq("id", purchaseInvoice.data.supplierId ?? "")
          .eq("companyId", companyId)
          .single(),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
          .in("entityType", ["SupplierType", "ItemPostingGroup", "Location"]),
      ]);
    if (items.error) throw new Error("Failed to fetch items");
    if (itemCosts.error) throw new Error("Failed to fetch item costs");
    if (purchaseOrderLines.error)
      throw new Error("Failed to fetch purchase order lines");
    if (supplier.error) throw new Error("Failed to fetch supplier");
    if (dimensions.error) {
      console.error("Failed to fetch dimensions", dimensions.error);
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    // Detect intercompany transaction
    const isIntercompany =
      supplier.data.intercompanyCompanyId != null;
    const intercompanyPartnerId = isIntercompany
      ? supplier.data.intercompanyCompanyId
      : null;

    const purchaseOrders = await client
      .from("purchaseOrder")
      .select("*")
      .in(
        "purchaseOrderId",
        purchaseOrderLines.data.reduce<string[]>((acc, purchaseOrderLine) => {
          if (
            purchaseOrderLine.purchaseOrderId &&
            !acc.includes(purchaseOrderLine.purchaseOrderId)
          ) {
            acc.push(purchaseOrderLine.purchaseOrderId);
          }
          return acc;
        }, [])
      )
      .eq("companyId", companyId);

    if (purchaseOrders.error)
      throw new Error("Failed to fetch purchase orders");

    const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
      [];

    const journalLineInserts: Omit<
      Database["public"]["Tables"]["journalLine"]["Insert"],
      "journalId"
    >[] = [];
    const journalLineDimensionsMeta: {
      supplierTypeId: string | null;
      itemPostingGroupId: string | null;
      locationId: string | null;
    }[] = [];

    const receiptLineInserts: Omit<
      Database["public"]["Tables"]["receiptLine"]["Insert"],
      "receiptId"
    >[] = [];

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    const purchaseInvoiceLinesByPurchaseOrderLine =
      purchaseInvoiceLines.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseInvoiceLine"]["Row"]
        >
      >((acc, invoiceLine) => {
        if (invoiceLine.purchaseOrderLineId) {
          acc[invoiceLine.purchaseOrderLineId] = invoiceLine;
        }
        return acc;
      }, {});

    const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
      Record<
        string,
        Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
      >
    >((acc, purchaseOrderLine) => {
      const invoiceLine =
        purchaseInvoiceLinesByPurchaseOrderLine[purchaseOrderLine.id];
      if (
        invoiceLine &&
        invoiceLine.quantity &&
        purchaseOrderLine.purchaseQuantity &&
        purchaseOrderLine.purchaseQuantity > 0
      ) {
        const newQuantityInvoiced =
          (purchaseOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

        const invoicedComplete =
          purchaseOrderLine.invoicedComplete ||
          invoiceLine.quantity >=
            (purchaseOrderLine.quantityToInvoice ??
              purchaseOrderLine.purchaseQuantity);

        return {
          ...acc,
          [purchaseOrderLine.id]: {
            quantityInvoiced: newQuantityInvoiced,
            invoicedComplete,
            purchaseOrderId: purchaseOrderLine.purchaseOrderId,
          },
        };
      }

      return acc;
    }, {});

    // Get account defaults (once for all lines)
    const accountDefaults = await getDefaultPostingGroup(client, companyId);
    if (accountDefaults.error || !accountDefaults.data) {
      throw new Error("Error getting account defaults");
    }

    // For IC transactions, use IC Payables (2020) instead of regular AP
    const payablesAccount = isIntercompany
      ? "2020"
      : accountDefaults.data.payablesAccount;

    for await (const invoiceLine of purchaseInvoiceLines.data) {
      const jlStartIdx = journalLineInserts.length;

      const invoiceLineQuantityInInventoryUnit =
        invoiceLine.quantity * (invoiceLine.conversionFactor ?? 1);

      const totalLineCost =
        invoiceLine.quantity * (invoiceLine.unitPrice ?? 0) +
        (invoiceLine.shippingCost ?? 0) +
        (invoiceLine.taxAmount ?? 0);

      const lineCostPercentageOfTotalCost =
        totalLinesCost === 0 ? 0 : totalLineCost / totalLinesCost;
      const lineWeightedShippingCost =
        shippingCost * lineCostPercentageOfTotalCost;
      const totalLineCostWithWeightedShipping =
        totalLineCost + lineWeightedShippingCost;

      let journalLineReference: string;

      switch (invoiceLine.invoiceLineType) {
        case "Part":
        case "Service":
        case "Consumable":
        case "Fixture":
        case "Material":
        case "Tool":
          {
            const item = items.data.find(
              (item) => item.id === invoiceLine.itemId
            );
            const itemTrackingType = item?.itemTrackingType ?? "Inventory";

            console.log({
              invoiceLineItemId: invoiceLine.itemId,
              foundItem: item,
              itemTrackingType,
              requiresSerialTracking: itemTrackingType === "Serial",
              requiresBatchTracking: itemTrackingType === "Batch",
            });

            // if there is no purchase order line, we create a receipt inline and post both sides
            if (invoiceLine.purchaseOrderLineId === null) {
              // create the receipt line
              receiptLineInserts.push({
                itemId: invoiceLine.itemId!,
                lineId: invoiceLine.id,
                orderQuantity: invoiceLineQuantityInInventoryUnit,
                outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                receivedQuantity: invoiceLineQuantityInInventoryUnit,
                locationId: invoiceLine.locationId,
                shelfId: invoiceLine.shelfId,
                unitOfMeasure: invoiceLine.inventoryUnitOfMeasureCode ?? "EA",
                unitPrice: invoiceLine.unitPrice ?? 0,
                requiresSerialTracking: itemTrackingType === "Serial",
                requiresBatchTracking: itemTrackingType === "Batch",
                createdBy: invoiceLine.createdBy,
                companyId,
              });

              // Only create item ledger entries if the receipt is being posted
              // (not when skipReceiptPost is true, as entries will be created when the receipt is posted later)
              if (itemTrackingType === "Inventory" && !skipReceiptPost) {
                // create the part ledger line
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: invoiceLine.itemId!,
                  quantity: invoiceLineQuantityInInventoryUnit,
                  locationId: invoiceLine.locationId,
                  shelfId: invoiceLine.shelfId,
                  entryType: "Positive Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: purchaseInvoice.data?.id ?? undefined,
                  externalDocumentId:
                    purchaseInvoice.data?.supplierReference ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              // create the cost ledger line
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Invoice",
                documentId: purchaseInvoice.data?.id ?? undefined,
                externalDocumentId:
                  purchaseInvoice.data?.supplierReference ?? undefined,
                itemId: invoiceLine.itemId,
                quantity: invoiceLineQuantityInInventoryUnit,
                nominalCost:
                  invoiceLine.quantity * (invoiceLine.unitPrice ?? 0),
                cost: totalLineCostWithWeightedShipping,
                supplierId: purchaseInvoice.data?.supplierId,
                companyId,
              });

              // Receipt side: DR asset / CR GR/IR
              if (!skipReceiptPost) {
                journalLineReference = nanoid();

                const assetAccount =
                  itemTrackingType === "Non-Inventory"
                    ? accountDefaults.data.indirectCostAccount
                    : accountDefaults.data.inventoryAccount;
                const assetDescription =
                  itemTrackingType === "Non-Inventory"
                    ? "Indirect Cost Account"
                    : "Inventory Account";

                // debit the asset account
                journalLineInserts.push({
                  accountNumber: assetAccount,
                  description: assetDescription,
                  amount: debit("asset", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                  companyGroupId,
                });

                // credit the GR/IR account
                journalLineInserts.push({
                  accountNumber:
                    accountDefaults.data.goodsReceivedNotInvoicedAccount,
                  description: "Goods Received Not Invoiced",
                  amount: credit(
                    "liability",
                    totalLineCostWithWeightedShipping
                  ),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                  companyGroupId,
                });
              }

              // Invoice side: DR GR/IR / CR AP
              journalLineReference = nanoid();

              // debit the GR/IR account
              journalLineInserts.push({
                accountNumber:
                  accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: debit("liability", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                journalLineReference,
                companyId,
                companyGroupId,
              });

              // credit the accounts payable account
              journalLineInserts.push({
                accountNumber: payablesAccount,
                description: isIntercompany
                  ? "IC Payables"
                  : "Accounts Payable",
                amount: credit("liability", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                journalLineReference,
                intercompanyPartnerId,
                companyId,
                companyGroupId,
              });
            } // if the line is associated with a purchase order line, just post invoice side (receipt already posted GR/IR credit)
            else {
              // create the cost entry
              costLedgerInserts.push({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Purchase Invoice",
                documentId: purchaseInvoice.data?.id ?? undefined,
                externalDocumentId:
                  purchaseInvoice.data?.supplierReference ?? undefined,
                itemId: invoiceLine.itemId,
                quantity: invoiceLineQuantityInInventoryUnit,
                nominalCost:
                  invoiceLine.quantity * (invoiceLine.unitPrice ?? 0),
                cost: totalLineCostWithWeightedShipping,
                supplierId: purchaseInvoice.data?.supplierId,
                companyId,
              });

              // Invoice side: DR GR/IR / CR AP
              journalLineReference = nanoid();

              // debit the GR/IR account
              journalLineInserts.push({
                accountNumber:
                  accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: debit(
                  "liability",
                  totalLineCostWithWeightedShipping
                ),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId!
                ),
                journalLineReference,
                companyId,
                companyGroupId,
              });

              // credit the accounts payable account
              journalLineInserts.push({
                accountNumber: payablesAccount,
                description: isIntercompany
                  ? "IC Payables"
                  : "Accounts Payable",
                amount: credit(
                  "liability",
                  totalLineCostWithWeightedShipping
                ),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId!
                ),
                journalLineReference,
                intercompanyPartnerId,
                companyId,
                companyGroupId,
              });
            }
          }

          break;
        case "Fixed Asset":
          // TODO: fixed assets
          break;
        case "Comment":
          break;
        case "G/L Account": {
          const account = await client
            .from("accounts")
            .select("name, number, isGroup")
            .eq("number", invoiceLine.accountNumber ?? "")
            .eq("companyGroupId", companyGroupId)
            .single();

          if (account.error || !account.data)
            throw new Error("Failed to fetch account");
          if (account.data.isGroup)
            throw new Error("Cannot post to a group account");

          // Receipt side: DR G/L Account / CR GR/IR
          if (!skipReceiptPost) {
            journalLineReference = nanoid();

            // debit the G/L account
            journalLineInserts.push({
              accountNumber: account.data.number!,
              description: account.data.name!,
              amount: debit("asset", totalLineCostWithWeightedShipping),
              quantity: invoiceLineQuantityInInventoryUnit,
              documentType: "Invoice",
              documentId: purchaseInvoice.data?.id,
              externalDocumentId: purchaseInvoice.data?.supplierReference,
              documentLineReference: journalReference.to.purchaseInvoice(
                invoiceLine.purchaseOrderLineId!
              ),
              journalLineReference,
              companyId,
              companyGroupId,
            });

            // credit the GR/IR account
            journalLineInserts.push({
              accountNumber:
                accountDefaults.data.goodsReceivedNotInvoicedAccount,
              description: "Goods Received Not Invoiced",
              amount: credit(
                "liability",
                totalLineCostWithWeightedShipping
              ),
              quantity: invoiceLineQuantityInInventoryUnit,
              documentType: "Invoice",
              documentId: purchaseInvoice.data?.id,
              externalDocumentId: purchaseInvoice.data?.supplierReference,
              documentLineReference: journalReference.to.purchaseInvoice(
                invoiceLine.purchaseOrderLineId!
              ),
              journalLineReference,
              companyId,
              companyGroupId,
            });
          }

          // Invoice side: DR GR/IR / CR AP
          journalLineReference = nanoid();

          // debit the GR/IR account
          journalLineInserts.push({
            accountNumber:
              accountDefaults.data.goodsReceivedNotInvoicedAccount,
            description: "Goods Received Not Invoiced",
            amount: debit("liability", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            companyId,
            companyGroupId,
          });

          // credit the accounts payable account
          journalLineInserts.push({
            accountNumber: payablesAccount!,
            description: isIntercompany
              ? "IC Payables"
              : "Accounts Payable",
            amount: credit("liability", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            intercompanyPartnerId,
            companyId,
            companyGroupId,
          });
          break;
        }
        default:
          throw new Error("Unsupported invoice line type");
      }

      // Track dimensions for this invoice line's journal lines
      const jlCount = journalLineInserts.length - jlStartIdx;
      const lineItemPostingGroupId = invoiceLine.itemId
        ? (itemCosts.data.find(
            (cost) => cost.itemId === invoiceLine.itemId
          )?.itemPostingGroupId ?? null)
        : null;
      for (let i = 0; i < jlCount; i++) {
        journalLineDimensionsMeta.push({
          supplierTypeId: supplier.data.supplierTypeId ?? null,
          itemPostingGroupId: lineItemPostingGroupId,
          locationId: invoiceLine.locationId ?? null,
        });
      }
    }

    const accountingPeriodId = await getCurrentAccountingPeriod(
      client,
      companyId,
      db
    );

    const createdReceiptIds: string[] = [];

    await db.transaction().execute(async (trx) => {
      if (receiptLineInserts.length > 0) {
        const receiptLinesGroupedByLocationId = receiptLineInserts.reduce<
          Record<string, typeof receiptLineInserts>
        >((acc, line) => {
          if (line.locationId) {
            if (line.locationId in acc) {
              acc[line.locationId].push(line);
            } else {
              acc[line.locationId] = [line];
            }
          }

          return acc;
        }, {});

        for await (const [locationId, receiptLines] of Object.entries(
          receiptLinesGroupedByLocationId
        )) {
          const readableReceiptId = await getNextSequence(
            trx,
            "receipt",
            companyId
          );
          const receipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: readableReceiptId,
              locationId,
              sourceDocument: "Purchase Invoice",
              sourceDocumentId: purchaseInvoice.data.id,
              sourceDocumentReadableId: purchaseInvoice.data.invoiceId,
              externalDocumentId: purchaseInvoice.data.supplierReference,
              supplierId: purchaseInvoice.data.supplierId,
              status: skipReceiptPost ? "Draft" : "Posted",
              postingDate: skipReceiptPost ? null : today,
              postedBy: skipReceiptPost ? null : userId,
              invoiced: true,
              companyId,
              createdBy: purchaseInvoice.data.createdBy,
            })
            .returning(["id"])
            .execute();

          const receiptId = receipt[0].id;
          if (!receiptId) throw new Error("Failed to insert receipt");
          createdReceiptIds.push(receiptId);

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLines.map((r) => ({
                ...r,
                receiptId: receiptId,
              }))
            )
            .returning(["id"])
            .execute();
        }
      }

      for await (const [purchaseOrderLineId, update] of Object.entries(
        purchaseOrderLineUpdates
      )) {
        await trx
          .updateTable("purchaseOrderLine")
          .set(update)
          .where("id", "=", purchaseOrderLineId)
          .execute();
      }

      const purchaseOrdersUpdated = Object.values(
        purchaseOrderLineUpdates
      ).reduce<string[]>((acc, update) => {
        if (update.purchaseOrderId && !acc.includes(update.purchaseOrderId)) {
          acc.push(update.purchaseOrderId);
        }
        return acc;
      }, []);

      for await (const purchaseOrderId of purchaseOrdersUpdated) {
        const purchaseOrderLines = await trx
          .selectFrom("purchaseOrderLine")
          .select([
            "id",
            "purchaseOrderLineType",
            "invoicedComplete",
            "receivedComplete",
          ])
          .where("purchaseOrderId", "=", purchaseOrderId)
          .execute();

        const areAllLinesInvoiced = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" || line.invoicedComplete
        );

        const areAllLinesReceived = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" || line.receivedComplete
        );

        let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
          "To Receive and Invoice";

        if (areAllLinesInvoiced && areAllLinesReceived) {
          status = "Completed";
        } else if (areAllLinesInvoiced) {
          status = "To Receive";
        } else if (areAllLinesReceived) {
          status = "To Invoice";
        }

        await trx
          .updateTable("purchaseOrder")
          .set({
            status,
          })
          .where("id", "=", purchaseOrderId)
          .execute();
      }

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
          description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
          postingDate: today,
          companyId,
          sourceType: "Purchase Invoice",
          status: "Posted",
          postedAt: new Date().toISOString(),
          postedBy: userId,
          createdBy: userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

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

        // Insert automatic dimensions for journal lines
        if (dimensionMap.size > 0) {
          const journalLineDimensionInserts: {
            journalLineId: string;
            dimensionId: string;
            valueId: string;
            companyId: string;
          }[] = [];

          journalLineResults.forEach((jl, index) => {
            const meta = journalLineDimensionsMeta[index];
            if (!meta) return;

            if (
              meta.supplierTypeId &&
              dimensionMap.has("SupplierType")
            ) {
              journalLineDimensionInserts.push({
                journalLineId: jl.id,
                dimensionId: dimensionMap.get("SupplierType")!,
                valueId: meta.supplierTypeId,
                companyId,
              });
            }
            if (
              meta.itemPostingGroupId &&
              dimensionMap.has("ItemPostingGroup")
            ) {
              journalLineDimensionInserts.push({
                journalLineId: jl.id,
                dimensionId: dimensionMap.get("ItemPostingGroup")!,
                valueId: meta.itemPostingGroupId,
                companyId,
              });
            }
            if (meta.locationId && dimensionMap.has("Location")) {
              journalLineDimensionInserts.push({
                journalLineId: jl.id,
                dimensionId: dimensionMap.get("Location")!,
                valueId: meta.locationId,
                companyId,
              });
            }
          });

          if (journalLineDimensionInserts.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(journalLineDimensionInserts)
              .execute();
          }
        }
      }

      if (itemLedgerInserts.length > 0) {
        await trx
          .insertInto("itemLedger")
          .values(itemLedgerInserts)
          .returning(["id"])
          .execute();
      }

      if (costLedgerInserts.length > 0) {
        await trx
          .insertInto("costLedger")
          .values(costLedgerInserts)
          .returning(["id"])
          .execute();
      }

      // Create intercompany transaction record if IC
      if (isIntercompany && intercompanyPartnerId) {
        const icJournalLineId = journalLineInserts.length > 0
          ? journalLineInserts[0].journalLineReference ?? "pending"
          : "pending";

        await trx
          .insertInto("intercompanyTransaction")
          .values({
            companyGroupId: companyGroupId!,
            sourceCompanyId: companyId,
            targetCompanyId: intercompanyPartnerId,
            sourceJournalLineId: icJournalLineId,
            amount: totalLinesCost,
            currencyCode: purchaseInvoice.data?.currencyCode ?? "USD",
            description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            status: "Unmatched",
          })
          .execute();
      }

      await trx
        .updateTable("purchaseInvoice")
        .set({
          datePaid: today, // TODO: remove this once we have payments working
          postingDate: today,
          status: "Submitted",
        })
        .where("id", "=", invoiceId)
        .execute();
    });

    return new Response(
      JSON.stringify({
        success: true,
        receiptIds: createdReceiptIds,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if ("invoiceId" in payload) {
      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? "",
        payload.companyId
      );
      await client
        .from("purchaseInvoice")
        .update({ status: "Draft" })
        .eq("id", payload.invoiceId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
