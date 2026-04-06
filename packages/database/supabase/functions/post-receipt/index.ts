import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import {
  credit,
  debit,
  journalReference,
  TrackedEntityAttributes,
} from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  receiptId: z.string(),
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
    const { receiptId, userId, companyId } = payloadValidator.parse(payload);

    console.log({
      function: "post-receipt",
      receiptId,
      userId,
      companyId,
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

    const [receipt, receiptLines, receiptLineTracking, dimensions] =
      await Promise.all([
        client.from("receipt").select("*").eq("id", receiptId).single(),
        client.from("receiptLine").select("*").eq("receiptId", receiptId),
        client
          .from("trackedEntity")
          .select("*")
          .eq("attributes->> Receipt", receiptId),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
          .in("entityType", ["SupplierType", "ItemPostingGroup", "Location"]),
      ]);

    if (receipt.error) throw new Error("Failed to fetch receipt");
    if (receiptLines.error) throw new Error("Failed to fetch receipt lines");
    if (dimensions.error) {
      console.error("Failed to fetch dimensions", dimensions.error);
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    const itemIds = receiptLines.data.reduce<string[]>((acc, receiptLine) => {
      if (receiptLine.itemId && !acc.includes(receiptLine.itemId)) {
        acc.push(receiptLine.itemId);
      }
      return acc;
    }, []);
    const [items, itemCosts] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }

    switch (receipt.data?.sourceDocument) {
      case "Purchase Order": {
        if (!receipt.data.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [purchaseOrder, purchaseOrderLines, purchaseOrderDelivery] =
          await Promise.all([
            client
              .from("purchaseOrder")
              .select("*")
              .eq("id", receipt.data.sourceDocumentId)
              .single(),
            client
              .from("purchaseOrderLine")
              .select("*")
              .eq("purchaseOrderId", receipt.data.sourceDocumentId),
            client
              .from("purchaseOrderDelivery")
              .select("supplierShippingCost")
              .eq("id", receipt.data.sourceDocumentId)
              .single(),
          ]);
        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchase order");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");
        if (purchaseOrderDelivery.error)
          throw new Error("Failed to fetch purchase order delivery");

        const shippingCost =
          (purchaseOrderDelivery.data?.supplierShippingCost ?? 0) *
          (purchaseOrder.data?.exchangeRate ?? 1);

        const totalLinesCost = receiptLines.data.reduce((acc, receiptLine) => {
          const safeReceivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          const lineCost =
            Math.abs(safeReceivedQuantity) * (receiptLine.unitPrice ?? 0);
          return acc + lineCost;
        }, 0);

        const supplier = await client
          .from("supplier")
          .select("*")
          .eq("id", purchaseOrder.data.supplierId)
          .eq("companyId", companyId)
          .single();
        if (supplier.error) throw new Error("Failed to fetch supplier");

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
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

        const isOutsideProcessing =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
          Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
        >((acc, receiptLine) => {
          if (receiptLine.lineId) {
            acc[receiptLine.lineId] = [
              ...(acc[receiptLine.lineId] ?? []),
              receiptLine,
            ];
          }
          return acc;
        }, {});

        const trackedEntityUpdates =
          receiptLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, itemTracking) => {
            const receiptLine = receiptLines.data?.find(
              (receiptLine) =>
                receiptLine.id ===
                (itemTracking.attributes as TrackedEntityAttributes)?.[
                  "Receipt Line"
                ]?.toString()
            );

            const safeReceivedQuantity =
              // @ts-ignore - chillllllll
              isNaN(receiptLine?.receivedQuantity) ||
              receiptLine?.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            const quantity = receiptLine?.requiresSerialTracking
              ? 1
              : safeReceivedQuantity || itemTracking.quantity;

            acc[itemTracking.id] = {
              status: "Available",
              quantity: quantity,
            };

            return acc;
          }, {}) ?? {};

        const jobOperationUpdates = isOutsideProcessing
          ? purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["jobOperation"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const receiptLines =
                receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                receiptLines &&
                receiptLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0 &&
                purchaseOrderLine.jobOperationId
              ) {
                const recivedQuantityInPurchaseUnit =
                  receiptLines.reduce((acc, receiptLine) => {
                    const safeReceivedQuantity =
                      isNaN(receiptLine.receivedQuantity) ||
                      receiptLine.receivedQuantity == null
                        ? 0
                        : receiptLine.receivedQuantity;
                    return acc + safeReceivedQuantity;
                  }, 0) / (receiptLines[0].conversionFactor ?? 1);

                const receivedComplete =
                  purchaseOrderLine.receivedComplete ||
                  recivedQuantityInPurchaseUnit >=
                    (purchaseOrderLine.quantityToReceive ??
                      purchaseOrderLine.purchaseQuantity);

                return {
                  ...acc,
                  [purchaseOrderLine.jobOperationId]: {
                    status: receivedComplete ? "Done" : "In Progress",
                  },
                };
              }

              return acc;
            }, {})
          : {};

        const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const receiptLines =
            receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            receiptLines &&
            receiptLines.length > 0 &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const recivedQuantityInPurchaseUnit =
              receiptLines.reduce((acc, receiptLine) => {
                const safeReceivedQuantity =
                  isNaN(receiptLine.receivedQuantity) ||
                  receiptLine.receivedQuantity == null
                    ? 0
                    : receiptLine.receivedQuantity;
                return acc + safeReceivedQuantity;
              }, 0) / (receiptLines[0].conversionFactor ?? 1);

            const newQuantityReceived =
              (purchaseOrderLine.quantityReceived ?? 0) +
              recivedQuantityInPurchaseUnit;

            const receivedComplete =
              purchaseOrderLine.receivedComplete ||
              recivedQuantityInPurchaseUnit >=
                (purchaseOrderLine.quantityToReceive ??
                  purchaseOrderLine.purchaseQuantity);

            return {
              ...acc,
              [purchaseOrderLine.id]: {
                quantityReceived: newQuantityReceived,
                receivedComplete,
                receivedDate: today,
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

        for await (const receiptLine of receiptLines.data) {
          const jlStartIdx = journalLineInserts.length;

          const itemTrackingType =
            items.data.find((item) => item.id === receiptLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          const receivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          const isNegativeReceipt = receivedQuantity < 0;
          const absReceivedQuantity = Math.abs(receivedQuantity);

          if (absReceivedQuantity > 0) {
            const lineCost = absReceivedQuantity * receiptLine.unitPrice;

            // Add proportional shipping cost based on line value percentage
            const lineValuePercentage =
              totalLinesCost === 0 ? 0 : lineCost / totalLinesCost;
            const lineWeightedShippingCost = shippingCost * lineValuePercentage;
            const cost = lineCost + lineWeightedShippingCost;

            const journalLineReference = nanoid();

            // Determine the debit account based on item type
            let debitAccount: string;
            let debitDescription: string;

            if (itemTrackingType !== "Non-Inventory" && !isOutsideProcessing) {
              // Inventory items: DR inventoryAccount
              debitAccount = accountDefaults.data.inventoryAccount;
              debitDescription = "Inventory Account";
            } else if (isOutsideProcessing) {
              // Outside processing: DR workInProgressAccount
              debitAccount = accountDefaults.data.workInProgressAccount;
              debitDescription = "WIP Account";
            } else {
              // Non-inventory items: DR indirectCostAccount
              debitAccount = accountDefaults.data.indirectCostAccount;
              debitDescription = "Indirect Cost Account";
            }

            if (isNegativeReceipt) {
              // For returns, flip: DR goodsReceivedNotInvoicedAccount / CR debitAccount
              journalLineInserts.push({
                accountNumber:
                  accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: debit("liability", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
                companyGroupId,
              });

              journalLineInserts.push({
                accountNumber: debitAccount,
                description: debitDescription,
                amount: credit("asset", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
                companyGroupId,
              });
            } else {
              // Normal receipt: DR debitAccount / CR goodsReceivedNotInvoicedAccount
              journalLineInserts.push({
                accountNumber: debitAccount,
                description: debitDescription,
                amount: debit("asset", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
                companyGroupId,
              });

              journalLineInserts.push({
                accountNumber:
                  accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: credit("liability", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
                companyGroupId,
              });
            }
          }

          if (itemTrackingType === "Inventory" && !isOutsideProcessing) {
            // For inventory entries, use the appropriate entry type based on quantity sign
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              locationId: receiptLine.locationId,
              shelfId: receiptLine.shelfId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (receiptLine.requiresBatchTracking && !isOutsideProcessing) {
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              locationId: receiptLine.locationId,
              shelfId: receiptLine.shelfId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              trackedEntityId: receiptLineTracking.data?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              )?.id,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (receiptLine.requiresSerialTracking && !isOutsideProcessing) {
            const lineTracking = receiptLineTracking.data?.filter(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Receipt Line"
                ] === receiptLine.id
            );

            const safeReceiptLineQuantity =
              isNaN(receiptLine.receivedQuantity) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            const absReceivedQuantity = Math.abs(safeReceiptLineQuantity);
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";
            const quantityPerEntry = receivedQuantity < 0 ? -1 : 1;

            for (let i = 0; i < absReceivedQuantity; i++) {
              const trackingWithIndex = lineTracking?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line Index"] === i
              );

              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: quantityPerEntry,
                locationId: receiptLine.locationId,
                shelfId: receiptLine.shelfId,
                entryType,
                documentType: "Purchase Receipt",
                documentId: receipt.data?.id ?? undefined,
                trackedEntityId: trackingWithIndex?.id,
                externalDocumentId:
                  receipt.data?.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId,
              });
            }
          }

          // Track dimensions for this receipt line's journal lines
          const jlCount = journalLineInserts.length - jlStartIdx;
          const lineItemPostingGroupId =
            itemCosts.data.find(
              (cost) => cost.itemId === receiptLine.itemId
            )?.itemPostingGroupId ?? null;
          for (let i = 0; i < jlCount; i++) {
            journalLineDimensionsMeta.push({
              supplierTypeId: supplier.data.supplierTypeId ?? null,
              itemPostingGroupId: lineItemPostingGroupId,
              locationId: receiptLine.locationId ?? null,
            });
          }
        }

        const accountingPeriodId = await getCurrentAccountingPeriod(
          client,
          companyId,
          db
        );

        await db.transaction().execute(async (trx) => {
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdates
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .execute();
          }

          for await (const [jobOperationId, update] of Object.entries(
            jobOperationUpdates
          )) {
            await trx
              .updateTable("jobOperation")
              .set(update)
              .where("id", "=", jobOperationId)
              .execute();
          }

          const purchaseOrderLines = await trx
            .selectFrom("purchaseOrderLine")
            .select([
              "id",
              "purchaseOrderLineType",
              "invoicedComplete",
              "receivedComplete",
            ])
            .where("purchaseOrderId", "=", purchaseOrder.data.id)
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
            .where("id", "=", purchaseOrder.data.id)
            .execute();

          await trx
            .updateTable("purchaseOrderDelivery")
            .set({
              deliveryDate: today,
              locationId: receipt.data.locationId,
            })
            .where("id", "=", receipt.data.sourceDocumentId)
            .execute();

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
              description: `Purchase Receipt ${receipt.data.receiptId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Receipt",
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

          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", receiptId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Receive",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receipt.data.receiptId,
                attributes: {
                  "Purchase Order": receipt.data.sourceDocumentId,
                  Receipt: receiptId,
                  Employee: userId,
                },
                companyId,
                createdBy: userId,
                createdAt: today,
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0].id;

            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityOutput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .execute();
              }
            }
          }
        });
        break;
      }
      case "Inbound Transfer": {
        if (!receipt.data.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
          client
            .from("warehouseTransfer")
            .select("*")
            .eq("id", receipt.data.sourceDocumentId)
            .single(),
          client
            .from("warehouseTransferLine")
            .select("*")
            .eq("transferId", receipt.data.sourceDocumentId),
        ]);

        if (warehouseTransfer.error)
          throw new Error("Failed to fetch warehouse transfer");
        if (warehouseTransferLines.error)
          throw new Error("Failed to fetch warehouse transfer lines");

        // Get item costs for valuation
        const transferItemIds = warehouseTransferLines.data
          .map((line) => line.itemId)
          .filter(Boolean) as string[];
        const itemCosts = await client
          .from("itemCost")
          .select("itemId, itemPostingGroupId, unitCost")
          .in("itemId", transferItemIds);

        if (itemCosts.error) {
          throw new Error("Failed to fetch item costs");
        }

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];
        const journalLineDimensionsMeta: {
          itemPostingGroupId: string | null;
          locationId: string | null;
        }[] = [];
        const warehouseTransferLineUpdates: Record<
          string,
          Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
        > = {};

        // Get account defaults (once for all lines)
        const accountDefaults = await getDefaultPostingGroup(client, companyId);
        if (accountDefaults.error || !accountDefaults.data) {
          throw new Error("Error getting account defaults");
        }

        // Process each receipt line
        for await (const receiptLine of receiptLines.data) {
          const jlStartIdx = journalLineInserts.length;

          const warehouseTransferLine = warehouseTransferLines.data.find(
            (line) => line.id === receiptLine.lineId
          );

          if (!warehouseTransferLine) continue;

          const receivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (receivedQuantity === 0) continue;

          // Update warehouse transfer line received quantity
          const newReceivedQuantity =
            (warehouseTransferLine.receivedQuantity ?? 0) + receivedQuantity;

          warehouseTransferLineUpdates[warehouseTransferLine.id] = {
            receivedQuantity: newReceivedQuantity,
          };

          // Get item cost for this item
          const itemCost = itemCosts.data?.find(
            (cost) => cost.itemId === receiptLine.itemId
          );
          const unitCost = itemCost?.unitCost ?? 0;
          const totalValue = Math.abs(receivedQuantity) * unitCost;

          // Create item ledger entry for positive adjustment at destination
          itemLedgerInserts.push({
            postingDate: today,
            itemId: receiptLine.itemId,
            quantity: receivedQuantity,
            locationId: receiptLine.locationId,
            shelfId: receiptLine.shelfId,
            entryType: "Transfer",
            documentType: "Transfer Receipt",
            documentId: warehouseTransfer.data?.transferId,
            externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
            createdBy: userId,
            companyId,
          });

          // Create journal entries for inventory movement if there's value
          if (totalValue > 0) {
            const journalLineReference = nanoid();

            // Credit (subtract) inventory from source location
            journalLineInserts.push({
              accountNumber: accountDefaults.data.inventoryAccount,
              description: `Transfer Out - ${warehouseTransfer.data?.transferId}`,
              amount: credit("asset", totalValue),
              quantity: Math.abs(receivedQuantity),
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId,
              companyGroupId,
            });

            // Debit (add) inventory to destination location
            journalLineInserts.push({
              accountNumber: accountDefaults.data.inventoryAccount,
              description: `Transfer In - ${warehouseTransfer.data?.transferId}`,
              amount: debit("asset", totalValue),
              quantity: Math.abs(receivedQuantity),
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId,
              companyGroupId,
            });
          }

          // Track dimensions for this receipt line's journal lines
          const jlCount = journalLineInserts.length - jlStartIdx;
          for (let i = 0; i < jlCount; i++) {
            journalLineDimensionsMeta.push({
              itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
              locationId: receiptLine.locationId ?? null,
            });
          }
        }

        // Check if all lines are fully received
        const allLinesFullyReceived = warehouseTransferLines.data.every(
          (line) => {
            const updates = warehouseTransferLineUpdates[line.id];
            const receivedQty =
              updates?.receivedQuantity ?? line.receivedQuantity ?? 0;
            return receivedQty >= (line.quantity ?? 0);
          }
        );

        // Check if all lines are fully shipped
        const allLinesFullyShipped = warehouseTransferLines.data.every(
          (line) => {
            const shippedQty = line.shippedQuantity ?? 0;
            return shippedQty >= (line.quantity ?? 0);
          }
        );

        // Determine new warehouse transfer status
        let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
          warehouseTransfer.data.status;

        if (allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "Completed";
        } else if (allLinesFullyReceived && !allLinesFullyShipped) {
          newStatus = "To Ship";
        } else if (!allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "To Receive";
        }

        const accountingPeriodId = await getCurrentAccountingPeriod(
          client,
          companyId,
          db
        );

        await db.transaction().execute(async (trx) => {
          // Update warehouse transfer lines
          for await (const [lineId, update] of Object.entries(
            warehouseTransferLineUpdates
          )) {
            await trx
              .updateTable("warehouseTransferLine")
              .set(update)
              .where("id", "=", lineId)
              .execute();
          }

          // Update warehouse transfer status
          await trx
            .updateTable("warehouseTransfer")
            .set({
              status: newStatus,
              updatedBy: userId,
            })
            .where("id", "=", warehouseTransfer.data.id)
            .execute();

          // Create journal entries if there are any
          if (journalLineInserts.length > 0) {
            const transferJournalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const transferJournalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId: transferJournalEntryId,
                accountingPeriodId,
                description: `Transfer Receipt ${receipt.data.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Transfer Receipt",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLineInserts.map((line) => ({
                  ...line,
                  journalId: transferJournalResult.id,
                }))
              )
              .returning(["id"])
              .execute();

            // Insert automatic dimensions for transfer journal lines
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

          // Create item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update receipt status
          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", receiptId)
            .execute();
        });

        break;
      }
      default: {
        break;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if ("receiptId" in payload) {
      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? "",
        payload.companyId
      );
      await client
        .from("receipt")
        .update({ status: "Draft" })
        .eq("id", payload.receiptId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
