import {
  Badge,
  Button,
  HStack,
  MenuIcon,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, type ReactNode, useMemo } from "react";
import {
  LuArrowDown,
  LuArrowLeftRight,
  LuArrowUp,
  LuBookMarked,
  LuCalendarX,
  LuFlag,
  LuHash,
  LuRefreshCcwDot,
  LuShoppingCart,
  LuTruck
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import {
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  Table,
  TrackingTypeIcon
} from "~/components";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { usePermissions, useRouteData, useUrlParams } from "~/hooks";
import { useItems } from "~/stores";
import {
  addToStockTransferSession,
  removeFromStockTransferSession,
  useStockTransferSession,
  useStockTransferSessionItemsCount
} from "~/stores/stock-transfer";
import { path } from "~/utils/path";
import {
  ACTIVE_JOB_STATUSES,
  getJobOrderStatusCategory,
  type ItemOrderStatus
} from "../../jobOrderStatus";
import type { Job, JobMaterial } from "../../types";
import { JobOrderStatusBadge } from "./JobOrderStatus";
import { StockTransferSessionWidget } from "./StockTransferSessionWidget";

type JobMaterialsTableProps = {
  data: JobMaterial[];
  count: number;
  nearExpiryWarningDays?: number | null;
  jobItemIds: string[];
  orderStatusByMaterialId: Record<string, ItemOrderStatus>;
};
function HeaderTooltip({ label, hint }: { label: ReactNode; hint: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

const JobMaterialsTable = memo(
  ({
    data,
    count,
    nearExpiryWarningDays,
    jobItemIds,
    orderStatusByMaterialId
  }: JobMaterialsTableProps) => {
    const { jobId } = useParams();
    const { t } = useLingui();
    if (!jobId) throw new Error("Job ID is required");

    // orderStatus is a derived value, not a real column, so its URL filter is
    // applied to the already-loaded rows here rather than in the query.
    const { getFilter } = useFilters();
    const orderStatusFilterKey = getFilter("orderStatus").join(",");

    const jobItemIdSet = useMemo(() => new Set(jobItemIds), [jobItemIds]);

    const filteredData = useMemo(() => {
      if (!orderStatusFilterKey) return data;
      const selected = new Set(orderStatusFilterKey.split(","));
      return data.filter((material) => {
        const category = getJobOrderStatusCategory(
          material.id ? orderStatusByMaterialId[material.id] : undefined
        );
        return category !== null && selected.has(category);
      });
    }, [data, orderStatusFilterKey, orderStatusByMaterialId]);

    const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
    const isRequired = ACTIVE_JOB_STATUSES.includes(
      routeData?.job?.status as (typeof ACTIVE_JOB_STATUSES)[number]
    );

    const fetcher = useFetcher<{}>();
    const formatter = useNumberFormatter();

    const [items] = useItems();
    const [, setSearchParams] = useUrlParams();

    const sessionItemsCount = useStockTransferSessionItemsCount();
    const [session, setStockTransferSession] = useStockTransferSession();

    useMount(() => {
      // Pre-populate stock transfer session with all parts that need transferred or ordered
      const itemsToAdd: Array<{
        id: string; // Job material ID
        itemId: string; // Actual item ID
        itemReadableId: string;
        description: string;
        action: "transfer" | "order";
        quantity: number;
        requiresSerialTracking: boolean;
        requiresBatchTracking: boolean;
        storageUnitId?: string;
      }> = [];

      data.forEach((material) => {
        if (
          material.itemTrackingType === "Non-Inventory" ||
          material.methodType === "Make to Order" ||
          !material.id
        ) {
          return;
        }

        const quantityRequiredByStorageUnit = isRequired
          ? material.quantityFromProductionOrderInStorageUnit
          : material.quantityFromProductionOrderInStorageUnit +
            material.estimatedQuantity;

        // Check if transfer is needed. Only propose moving what actually exists
        // in OTHER storage units (quantityOnHandNotInStorageUnit) — a transfer
        // can't source stock that isn't there. Any remaining gap is a genuine
        // shortage, handled by the order path below.
        const quantityOnHandInStorageUnit =
          material.quantityOnHandInStorageUnit;
        const quantityInTransitToStorageUnit =
          material.quantityInTransitToStorageUnit;
        const transferQuantity = Math.min(
          quantityRequiredByStorageUnit -
            (quantityOnHandInStorageUnit + quantityInTransitToStorageUnit),
          material.quantityOnHandNotInStorageUnit
        );

        if (transferQuantity > 0) {
          itemsToAdd.push({
            id: material.id, // Job material ID
            itemId: material.jobMaterialItemId, // Actual item ID
            itemReadableId: material.itemReadableId,
            description: material.description,
            action: "transfer",
            quantity: transferQuantity,
            requiresSerialTracking: material.itemTrackingType === "Serial",
            requiresBatchTracking: material.itemTrackingType === "Batch",
            storageUnitId: material.storageUnitId
          });
        }

        // Check if order is needed
        const quantityOnHand =
          material.quantityOnHandInStorageUnit +
          material.quantityOnHandNotInStorageUnit;

        const incoming =
          material.quantityOnPurchaseOrder + material.quantityOnProductionOrder;

        const required =
          material.quantityFromProductionOrderInStorageUnit +
          material.quantityFromProductionOrderNotInStorageUnit +
          material.quantityOnSalesOrder;

        const hasTotalQuantityFlag = quantityOnHand + incoming - required < 0;

        if (hasTotalQuantityFlag) {
          itemsToAdd.push({
            id: material.id, // Job material ID
            itemId: material.jobMaterialItemId, // Actual item ID
            itemReadableId: material.itemReadableId,
            description: material.description,
            action: "order",
            quantity:
              (material.estimatedQuantity ?? 0) -
              (quantityOnHand + incoming - required),
            requiresSerialTracking: material.itemTrackingType === "Serial",
            requiresBatchTracking: material.itemTrackingType === "Batch",
            storageUnitId: material.storageUnitId
          });
        }
      });

      if (itemsToAdd.length > 0) {
        setStockTransferSession({ items: itemsToAdd });
      }
    });

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<JobMaterial>[]>(() => {
      return [
        {
          accessorKey: "jobMaterialItemId",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="md"
                // @ts-ignore
                type={row.original.itemType}
              />

              <VStack spacing={0}>
                <HStack spacing={2}>
                  <Hyperlink
                    to={path.to.jobMakeMethod(
                      jobId,
                      row.original.jobMakeMethodId
                    )}
                    onClick={() => {
                      setSearchParams({ materialId: row.original.id ?? null });
                    }}
                    className="max-w-[260px] truncate"
                  >
                    {row.original.itemReadableId}
                  </Hyperlink>
                  {nearExpiryWarningDays !== null &&
                    nearExpiryWarningDays !== undefined &&
                    row.original.hasExpiredBatch && (
                      <Badge variant="red" className="gap-1 text-xs shrink-0">
                        <LuCalendarX className="size-3" />
                        <Trans>Expired batch</Trans>
                      </Badge>
                    )}
                </HStack>
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.description}
                </div>
              </VStack>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />,
            // Filter by item id (a real column) so it filters server-side;
            // scoped to items on this job, with the readable id as the label.
            filter: {
              type: "static",
              options: items
                .filter((item) => jobItemIdSet.has(item.id))
                .map((item) => ({
                  value: item.id,
                  label: item.readableIdWithRevision
                }))
            }
          }
        },
        {
          id: "orderStatus",
          header: () => (
            <HeaderTooltip
              label={t`Status`}
              hint={
                <Trans>
                  Procurement status — needs ordering, planned, on order, or
                  received. The same indicator shown in the BoM tree.
                </Trans>
              }
            />
          ),
          cell: ({ row }) => (
            <JobOrderStatusBadge
              status={
                row.original.id
                  ? orderStatusByMaterialId[row.original.id]
                  : undefined
              }
            />
          ),
          meta: {
            icon: <LuShoppingCart />,
            // `header` is JSX (tooltip), so name the column for the filter UI.
            filterHeader: t`Status`,
            // Categories must match getJobOrderStatusCategory's return values.
            filter: {
              type: "static",
              isArray: true,
              options: [
                { value: "needsOrder", label: t`Needs ordering` },
                { value: "planned", label: t`Planned` },
                { value: "awaitingApproval", label: t`Awaiting approval` },
                { value: "onOrder", label: t`On order` },
                { value: "received", label: t`Received` }
              ]
            }
          }
        },
        {
          accessorKey: "estimatedQuantity",
          header: () => (
            <HeaderTooltip
              label={t`Required`}
              hint={
                <Trans>
                  This job's own required quantity for the material.
                </Trans>
              }
            />
          ),
          cell: ({ row }) => formatter.format(row.original.estimatedQuantity),
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "method",
          header: () => (
            <HeaderTooltip
              label={t`Method`}
              hint={
                <Trans>
                  How the material is sourced (make, purchase, or pull from
                  inventory) and the storage unit it's pulled from.
                </Trans>
              }
            />
          ),
          cell: ({ row }) => (
            <HStack>
              <Badge variant="secondary">
                <MethodIcon
                  type={row.original.methodType}
                  className="size-3 mr-1"
                />
                {row.original.storageUnitName ??
                  (row.original.methodType === "Make to Order"
                    ? t`WIP`
                    : t`Default Storage Unit`)}
              </Badge>
            </HStack>
          )
        },

        {
          id: "quantityOnHandInStorageUnit",
          header: () => (
            <HeaderTooltip
              label={t`On Storage Unit`}
              hint={
                <Trans>
                  Quantity physically on the material's assigned storage unit
                  (shelf). Turns red when it's below what that unit needs to
                  supply.
                </Trans>
              }
            />
          ),
          cell: ({ row }) => {
            const isInventoried =
              row.original.itemTrackingType !== "Non-Inventory";
            if (!isInventoried)
              return (
                <Badge variant="secondary">
                  <TrackingTypeIcon type="Non-Inventory" className="mr-2" />
                  <span>Non-Inventory</span>
                </Badge>
              );

            const quantityRequiredByStorageUnit = isRequired
              ? row.original.quantityFromProductionOrderInStorageUnit
              : row.original.quantityFromProductionOrderInStorageUnit +
                row.original.estimatedQuantity;

            if (row.original.methodType === "Make to Order") {
              return null;
            }

            const quantityOnHandInStorageUnit =
              row.original.quantityOnHandInStorageUnit;
            const quantityInTransitToStorageUnit =
              row.original.quantityInTransitToStorageUnit;
            const hasStorageUnitQuantityFlag =
              quantityOnHandInStorageUnit + quantityInTransitToStorageUnit <
              quantityRequiredByStorageUnit;

            return (
              <HStack>
                {hasStorageUnitQuantityFlag ? (
                  <>
                    <span className="text-red-500">
                      {formatter.format(quantityOnHandInStorageUnit)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <LuFlag className="text-red-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="font-medium">
                            Storage unit demand exceeds supply
                          </div>
                          <div>
                            On hand at unit:{" "}
                            {formatter.format(quantityOnHandInStorageUnit)}
                          </div>
                          <div>
                            In transit to unit:{" "}
                            {formatter.format(quantityInTransitToStorageUnit)}
                          </div>
                          <div>
                            Required at unit:{" "}
                            {formatter.format(quantityRequiredByStorageUnit)}
                          </div>
                          <div className="font-medium">
                            Net:{" "}
                            {formatter.format(
                              quantityOnHandInStorageUnit +
                                quantityInTransitToStorageUnit -
                                quantityRequiredByStorageUnit
                            )}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <span>{formatter.format(quantityOnHandInStorageUnit)}</span>
                )}
              </HStack>
            );
          },
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "quantityOnHand",
          header: () => (
            <HeaderTooltip
              label={t`On Hand`}
              hint={
                <Trans>
                  Total quantity on hand for the item across all storage units
                  at this location. Turns red when on hand plus incoming can't
                  cover total demand.
                </Trans>
              }
            />
          ),
          cell: ({ row }) => {
            if (
              row.original.itemTrackingType === "Non-Inventory" ||
              row.original.methodType === "Make to Order"
            ) {
              return null;
            }
            const quantityOnHand =
              row.original.quantityOnHandInStorageUnit +
              row.original.quantityOnHandNotInStorageUnit;

            const incoming =
              row.original.quantityOnPurchaseOrder +
              row.original.quantityOnProductionOrder;

            const required =
              row.original.quantityFromProductionOrderInStorageUnit +
              row.original.quantityFromProductionOrderNotInStorageUnit +
              row.original.quantityOnSalesOrder;

            const hasTotalQuantityFlag =
              quantityOnHand + incoming - required < 0;

            return (
              <HStack>
                {hasTotalQuantityFlag ? (
                  <>
                    <span className="text-red-500">
                      {formatter.format(quantityOnHand)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <LuFlag className="text-red-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="font-medium">
                            Future demand exceeds supply
                          </div>
                          <div>On hand: {formatter.format(quantityOnHand)}</div>
                          <div>Incoming: {formatter.format(incoming)}</div>
                          <div>Required: {formatter.format(required)}</div>
                          <div className="font-medium">
                            Net:{" "}
                            {formatter.format(
                              quantityOnHand + incoming - required
                            )}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <span>{formatter.format(quantityOnHand)}</span>
                )}
              </HStack>
            );
          },
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "required",
          header: () => (
            <HeaderTooltip
              label={t`Required`}
              hint={
                <Trans>
                  Total quantity required across all active jobs and sales
                  orders at this location — not just this job.
                </Trans>
              }
            />
          ),
          cell: ({ row }) =>
            formatter.format(
              row.original.quantityFromProductionOrderInStorageUnit +
                row.original.quantityFromProductionOrderNotInStorageUnit +
                row.original.quantityOnSalesOrder
            ),
          meta: { icon: <LuArrowDown className="text-red-600" /> }
        },
        {
          id: "incoming",
          header: () => (
            <HeaderTooltip
              label={t`Incoming`}
              hint={
                <Trans>
                  Quantity arriving — on open purchase orders plus on production
                  (make) orders.
                </Trans>
              }
            />
          ),
          cell: ({ row }) =>
            formatter.format(
              row.original.quantityOnPurchaseOrder +
                row.original.quantityOnProductionOrder
            ),
          meta: {
            icon: <LuArrowUp className="text-emerald-600" />
          }
        },
        {
          id: "transfer",
          header: () => (
            <HeaderTooltip
              label={t`Transfer`}
              hint={
                <Trans>
                  Quantity in transit to the storage unit via open stock
                  transfers.
                </Trans>
              }
            />
          ),
          cell: ({ row }) =>
            formatter.format(row.original.quantityInTransitToStorageUnit),
          meta: {
            icon: <LuArrowLeftRight className="text-blue-600" />
          }
        }
      ];
    }, [
      items,
      jobId,
      setSearchParams,
      isRequired,
      formatter,
      sessionItemsCount,
      jobItemIdSet,
      orderStatusByMaterialId
    ]);

    const renderContextMenu = useMemo(() => {
      return (row: JobMaterial) => {
        // Skip non-inventory items and make items
        if (
          row.itemTrackingType === "Non-Inventory" ||
          row.methodType === "Make to Order" ||
          !row.id
        ) {
          return null;
        }

        const quantityRequiredByStorageUnit = isRequired
          ? row.quantityFromProductionOrderInStorageUnit
          : row.quantityFromProductionOrderInStorageUnit +
            row.estimatedQuantity;

        const quantityOnHandInStorageUnit = row.quantityOnHandInStorageUnit;

        const quantityOnHand =
          row.quantityOnHandInStorageUnit + row.quantityOnHandNotInStorageUnit;
        const incoming =
          row.quantityOnPurchaseOrder + row.quantityOnProductionOrder;
        const required =
          row.quantityFromProductionOrderInStorageUnit +
          row.quantityFromProductionOrderNotInStorageUnit +
          row.quantityOnSalesOrder;

        // Check if items are already in session
        const isInSessionForTransfer = session.items.some(
          (item) => item.id === row.id && item.action === "transfer"
        );
        const isInSessionForOrder = session.items.some(
          (item) => item.id === row.id && item.action === "order"
        );

        return (
          <>
            <MenuItem
              destructive={isInSessionForTransfer}
              onClick={() => {
                if (isInSessionForTransfer) {
                  removeFromStockTransferSession(row.id!, "transfer");
                } else {
                  addToStockTransferSession({
                    id: row.id!, // Job material ID
                    itemId: row.jobMaterialItemId, // Actual item ID
                    itemReadableId: row.itemReadableId,
                    description: row.description,
                    action: "transfer",
                    quantity:
                      quantityRequiredByStorageUnit -
                      quantityOnHandInStorageUnit,
                    requiresSerialTracking: row.itemTrackingType === "Serial",
                    requiresBatchTracking: row.itemTrackingType === "Batch",
                    storageUnitId: row.storageUnitId
                  });
                }
              }}
            >
              <MenuIcon icon={<LuTruck />} />
              {isInSessionForTransfer ? t`Remove Transfer` : t`Transfer`}
            </MenuItem>
            <MenuItem
              destructive={isInSessionForOrder}
              onClick={() => {
                if (isInSessionForOrder) {
                  removeFromStockTransferSession(row.id!, "order");
                } else {
                  addToStockTransferSession({
                    id: row.id!, // Job material ID
                    itemId: row.jobMaterialItemId, // Actual item ID
                    itemReadableId: row.itemReadableId,
                    description: row.description,
                    action: "order",
                    quantity:
                      (row.estimatedQuantity ?? 0) -
                      (quantityOnHand + incoming - required),
                    requiresSerialTracking: row.itemTrackingType === "Serial",
                    requiresBatchTracking: row.itemTrackingType === "Batch",
                    storageUnitId: row.storageUnitId
                  });
                }
              }}
            >
              <MenuIcon icon={<LuShoppingCart />} />
              {isInSessionForOrder ? t`Remove Order` : t`Order`}
            </MenuItem>
          </>
        );
      };
    }, [isRequired, session.items, t]);

    const permissions = usePermissions();

    return (
      <>
        <Table<JobMaterial>
          compact
          count={orderStatusFilterKey ? filteredData.length : count}
          columns={columns}
          data={filteredData}
          primaryAction={
            data.length > 0 && permissions.can("update", "production") ? (
              <fetcher.Form
                action={path.to.jobRecalculate(jobId)}
                method="post"
              >
                <Button
                  leftIcon={<LuRefreshCcwDot />}
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  type="submit"
                  variant="secondary"
                >
                  <Trans>Recalculate</Trans>
                </Button>
              </fetcher.Form>
            ) : undefined
          }
          renderContextMenu={renderContextMenu}
          title={t`Materials`}
        />
        <StockTransferSessionWidget jobId={jobId} />
      </>
    );
  }
);

JobMaterialsTable.displayName = "JobMaterialsTable";

export default JobMaterialsTable;
