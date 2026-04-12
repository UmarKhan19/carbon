import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { z } from "zod";
import type {
  ProductionOrder,
  ProductionPlanningItem
} from "~/modules/production";
import type {
  PlannedOrder,
  PurchasingPlanningItem
} from "~/modules/purchasing";
import type { Item } from "~/stores";
import type { ItemReorderingPolicy } from "../../types";

export function ItemReorderPolicy({
  reorderingPolicy,
  className
}: {
  reorderingPolicy: Database["public"]["Enums"]["itemReorderingPolicy"];
  className?: string;
}) {
  switch (reorderingPolicy) {
    case "Manual Reorder":
      return (
        <Status color="gray" className={className}>
          <Trans>Manual</Trans>
        </Status>
      );
    case "Demand-Based Reorder":
      return (
        <Status color="blue" className={className}>
          <Trans>Demand-Based</Trans>
        </Status>
      );
    case "Fixed Reorder Quantity":
      return (
        <Status color="green" className={className}>
          <Trans>Fixed Reorder</Trans>
        </Status>
      );
    case "Maximum Quantity":
      return (
        <Status color="purple" className={className}>
          <Trans>Max Quantity</Trans>
        </Status>
      );
  }
}

export function getReorderPolicyDescription(itemPlanning: {
  reorderingPolicy: ItemReorderingPolicy;
  reorderPoint: number;
  reorderQuantity: number;
  maximumInventoryQuantity: number;
  demandAccumulationPeriod: number;
  demandAccumulationSafetyStock: number;
}) {
  const reorderPoint = itemPlanning.reorderPoint;
  switch (itemPlanning.reorderingPolicy) {
    case "Manual Reorder":
      return "Manually reorder the item";
    case "Demand-Based Reorder":
      const demandAccumulationPeriod = itemPlanning.demandAccumulationPeriod;
      return `Order enough to cover the next ${demandAccumulationPeriod} weeks`;
    case "Fixed Reorder Quantity":
      const reorderQuantity = itemPlanning.reorderQuantity;
      return `When stock is below ${reorderPoint}, order ${reorderQuantity} units`;
    case "Maximum Quantity":
      const maximumInventoryQuantity = itemPlanning.maximumInventoryQuantity;
      return `When stock is below ${reorderPoint}, order up to ${maximumInventoryQuantity} units`;
  }
}

type BaseOrderParams = {
  itemPlanning: ProductionPlanningItem | PurchasingPlanningItem;
  periods: { startDate: string; id: string }[];
};

// Cache for memoizing calculateOrders results
const ordersCache = new Map<
  string,
  {
    startDate: string;
    dueDate: string;
    quantity: number;
    periodId: string;
    isASAP: boolean;
  }[]
>();

// Generate cache key from itemPlanning and periods
function getCacheKey(
  itemPlanning: ProductionPlanningItem | PurchasingPlanningItem,
  periods: { startDate: string; id: string }[]
): string {
  // Include all relevant properties that affect order calculation
  const periodIds = periods.map((p) => p.id).join(",");
  const weekValues = Array.from({ length: 48 }, (_, i) => {
    const key = `week${i + 1}` as keyof typeof itemPlanning;
    return itemPlanning[key] ?? 0;
  }).join(",");

  return `${itemPlanning.id}_${itemPlanning.reorderingPolicy}_${itemPlanning.reorderPoint}_${itemPlanning.reorderQuantity}_${itemPlanning.maximumInventoryQuantity}_${itemPlanning.demandAccumulationPeriod}_${itemPlanning.demandAccumulationSafetyStock}_${itemPlanning.leadTime}_${itemPlanning.lotSize}_${itemPlanning.minimumOrderQuantity}_${itemPlanning.maximumOrderQuantity}_${itemPlanning.orderMultiple}_${periodIds}_${weekValues}`;
}

function calculateOrders({ itemPlanning, periods }: BaseOrderParams): {
  startDate: string;
  dueDate: string;
  quantity: number;
  periodId: string;
  isASAP: boolean;
}[] {
  // Check cache first
  const cacheKey = getCacheKey(itemPlanning, periods);
  const cached = ordersCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  if (itemPlanning.reorderingPolicy === "Manual Reorder") {
    const emptyOrders: {
      startDate: string;
      dueDate: string;
      quantity: number;
      periodId: string;
      isASAP: boolean;
    }[] = [];
    ordersCache.set(cacheKey, emptyOrders);
    return emptyOrders;
  }

  const orders: {
    startDate: string;
    dueDate: string;
    quantity: number;
    periodId: string;
    isASAP: boolean;
  }[] = [];

  const {
    demandAccumulationPeriod,
    demandAccumulationSafetyStock,
    leadTime,
    lotSize,
    maximumInventoryQuantity,
    maximumOrderQuantity,
    minimumOrderQuantity,
    orderMultiple,
    reorderPoint,
    reorderQuantity
  } = itemPlanning;

  const todaysDate = today(getLocalTimeZone());
  let orderedQuantity = 0;

  switch (itemPlanning.reorderingPolicy) {
    case "Demand-Based Reorder":
      // Process periods in chunks of demandAccumulationPeriod
      for (let i = 0; i < periods.length; i += demandAccumulationPeriod) {
        const currentPeriod = periods[i];

        // Calculate total demand for accumulation period
        let projectedStock = 0;
        for (
          let j = i;
          j < Math.min(i + demandAccumulationPeriod, periods.length);
          j++
        ) {
          const periodKey = `week${j + 1}` as "week1";
          const periodProjection = (itemPlanning[periodKey] as number) || 0;
          projectedStock = periodProjection + orderedQuantity;
        }

        // If projected stock is below safety stock, create order
        if (projectedStock < demandAccumulationSafetyStock) {
          let totalOrderQuantity =
            demandAccumulationSafetyStock - projectedStock;

          // Apply lot sizing rules
          if (maximumOrderQuantity > 0) {
            totalOrderQuantity = Math.min(
              totalOrderQuantity,
              maximumOrderQuantity
            );
          }
          totalOrderQuantity = Math.max(
            totalOrderQuantity,
            minimumOrderQuantity
          );

          if (orderMultiple > 0) {
            totalOrderQuantity =
              Math.ceil(totalOrderQuantity / orderMultiple) * orderMultiple;
          }

          // If we have a lot size and need to split orders
          if (lotSize > 0 && totalOrderQuantity > lotSize) {
            const numberOfBatches = Math.ceil(totalOrderQuantity / lotSize);
            const daysInPeriod = 7; // Assuming weekly periods

            for (let batch = 0; batch < numberOfBatches; batch++) {
              const batchQuantity = Math.min(
                lotSize,
                totalOrderQuantity - batch * lotSize
              );

              // Spread due dates evenly across the period
              const dueDateOffset = Math.floor(
                (batch * daysInPeriod) / numberOfBatches
              );
              const dueDate = parseDate(currentPeriod.startDate).add({
                days: dueDateOffset
              });
              const startDate = dueDate.subtract({ days: leadTime });

              orders.push({
                startDate: startDate.toString(),
                dueDate: dueDate.toString(),
                quantity: batchQuantity,
                periodId: currentPeriod.id,
                isASAP: startDate.compare(todaysDate) < 0
              });
            }
          } else {
            // Single order for the period
            const orderQuantity =
              lotSize > 0
                ? Math.min(totalOrderQuantity, lotSize)
                : totalOrderQuantity;

            const dueDate = parseDate(currentPeriod.startDate);
            const startDate = dueDate.subtract({ days: leadTime });

            orders.push({
              startDate: startDate.toString(),
              dueDate: dueDate.toString(),
              quantity: orderQuantity,
              periodId: currentPeriod.id,
              isASAP: startDate.compare(todaysDate) < 0
            });
          }

          orderedQuantity += totalOrderQuantity;
        }
      }

      ordersCache.set(cacheKey, orders);
      return orders;
    case "Fixed Reorder Quantity":
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const periodKey = `week${i + 1}` as "week1";
        const projectedQuantity = (itemPlanning[periodKey] as number) || 0;

        // Check if we need to order based on reorder point
        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        let maxIterations = 100; // Safety counter to prevent infinite loops
        while (remainingQuantityNeeded > 0 && day < 5 && maxIterations-- > 0) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({
            days: leadTime
          });

          // If reorder quantity is 0, order the same quantity as the reorder point
          const orderQuantity =
            reorderQuantity > 0 ? reorderQuantity : reorderPoint;

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
            periodId: period.id,
            isASAP: startDate.compare(todaysDate) < 0
          });
          day++;
          orderedQuantity += orderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }

      ordersCache.set(cacheKey, orders);
      return orders;
    case "Maximum Quantity":
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const periodKey = `week${i + 1}` as "week1";
        const projectedQuantity = (itemPlanning[periodKey] as number) || 0;

        // Check if we need to order based on reorder point
        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        let maxIterations = 100; // Safety counter to prevent infinite loops
        while (remainingQuantityNeeded > 0 && day < 5 && maxIterations-- > 0) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({
            days: leadTime
          });

          // Calculate required quantity up to maximum inventory
          const requiredQuantity =
            maximumInventoryQuantity - (projectedQuantity + orderedQuantity);

          // If reorder quantity is 0, use reorder point as the base order quantity
          let orderQuantity =
            reorderQuantity > 0
              ? Math.max(minimumOrderQuantity, requiredQuantity)
              : reorderPoint;

          // Ensure orderQuantity is positive to prevent infinite loop
          if (orderQuantity <= 0) {
            break;
          }

          // Round to nearest multiple if specified
          if (orderMultiple && orderMultiple > 1) {
            orderQuantity =
              Math.ceil(orderQuantity / orderMultiple) * orderMultiple;
          }

          // Only apply lot size if it's greater than 0
          if (lotSize > 0) {
            orderQuantity = Math.ceil(orderQuantity / lotSize) * lotSize;
          }

          // Apply maximum order quantity only if it's greater than 0
          if (maximumOrderQuantity > 0) {
            orderQuantity = Math.min(orderQuantity, maximumOrderQuantity);
          }

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
            periodId: period.id,
            isASAP:
              startDate.compare(todaysDate) < 0 &&
              projectedQuantity + orderedQuantity < 0
          });
          day++;
          orderedQuantity += orderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }
      ordersCache.set(cacheKey, orders);
      return orders;
    default:
      ordersCache.set(cacheKey, orders);
      return orders;
  }
}

// Export function to clear the cache if needed (e.g., after MRP runs)
export function clearOrdersCache() {
  ordersCache.clear();
}

export function getProductionOrdersFromPlanning(
  itemPlanning: ProductionPlanningItem,
  periods: { startDate: string; id: string }[]
): ProductionOrder[] {
  return calculateOrders({ itemPlanning, periods });
}

const supplierPartValidator = z.array(
  z.object({
    id: z.string(),
    supplierId: z.string(),
    supplierUnitOfMeasureCode: z.string(),
    conversionFactor: z.number(),
    unitPrice: z.number()
  })
);

export function getPurchaseOrdersFromPlanning(
  itemPlanning: PurchasingPlanningItem,
  periods: { startDate: string; id: string }[],
  items: Item[],
  supplierId?: string
): PlannedOrder[] {
  const suppliers = supplierPartValidator.safeParse(itemPlanning.suppliers);
  const supplier = suppliers.data?.find(
    (supplier) => supplier.supplierId === supplierId
  );

  const item = items.find((item) => item.id === itemPlanning.id);

  // Get the conversion factor from the selected supplier
  const conversionFactor = supplier?.conversionFactor ?? 1;

  return calculateOrders({ itemPlanning, periods }).map((order) => ({
    ...order,
    // Convert inventory quantity to purchase quantity by dividing by conversion factor
    quantity:
      conversionFactor > 0
        ? Math.ceil(order.quantity / conversionFactor)
        : order.quantity,
    supplierId: supplier?.supplierId ?? itemPlanning.preferredSupplierId,
    itemReadableId: item?.readableIdWithRevision,
    description: item?.name,
    unitOfMeasureCode: item?.unitOfMeasureCode
  }));
}
