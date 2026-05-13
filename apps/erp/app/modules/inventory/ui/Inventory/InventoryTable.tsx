import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuBoxes,
  LuCalculator,
  LuCheck,
  LuCircleCheck,
  LuCirclePlay,
  LuClock,
  LuExpand,
  LuGlassWater,
  LuLoaderCircle,
  LuMoveDown,
  LuMoveUp,
  LuPackage,
  LuPaintBucket,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuStar,
  LuTag,
  LuWarehouse
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
  TrackingTypeIcon
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams } from "~/hooks";
import {
  itemReorderingPolicies,
  itemReplenishmentSystems
} from "~/modules/items";
import {
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  forms: ListItem[];
  substances: ListItem[];
  tags: string[];
  storageTypes: { id: string; name: string }[];
};

const InventoryTable = memo(
  ({
    data,
    count,
    locationId,
    forms,
    substances,
    tags,
    storageTypes
  }: InventoryTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();

    const translateReplenishment = useCallback(
      (v: string) =>
        v === "Buy" ? t`Buy` : v === "Make" ? t`Make` : t`Buy and Make`,
      [t]
    );

    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();
    const { options: storageUnitOptions } = useStorageUnits(locationId);

    const filters = useFilters();
    const materialSubstanceId = filters.getFilter("materialSubstanceId")?.[0];
    const materialFormId = filters.getFilter("materialFormId")?.[0];
    const numberFormatter = useNumberFormatter();
    const formatNumber = numberFormatter.format.bind(numberFormatter);

    const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
      return [
        {
          accessorKey: "readableIdWithRevision",
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-expect-error
                type={row.original.type}
              />

              <Hyperlink
                to={`${path.to.inventoryItem(row.original.id!)}/?${params}`}
              >
                <VStack spacing={0}>
                  {row.original.readableIdWithRevision}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {row.original.name}
                  </div>
                </VStack>
              </Hyperlink>
            </HStack>
          ),
          header: t`Item ID`,
          meta: {
            icon: <LuBookMarked />
          }
        },

        {
          accessorKey: "quantityOnHand",
          cell: ({ row }) =>
            row.original.itemTrackingType === "Non-Inventory" ? (
              <TrackingTypeIcon type="Non-Inventory" />
            ) : (
              formatNumber(row.original.quantityOnHand)
            ),
          header: t`On Hand`,
          meta: {
            formatter: formatNumber,
            icon: <LuPackage />,
            renderTotal: true
          }
        },

        {
          accessorKey: "daysRemaining",
          cell: ({ row }) => formatNumber(row.original.daysRemaining),
          header: t`Days`,
          meta: {
            formatter: formatNumber,
            icon: <LuClock />,
            renderTotal: true
          }
        },
        {
          accessorKey: "leadTime",
          cell: ({ row }) => formatNumber(row.original.leadTime),
          header: t`Lead Time`,
          meta: {
            formatter: formatNumber,
            icon: <LuClock />,
            renderTotal: true
          }
        },
        {
          accessorKey: "reorderingPolicy",
          cell: ({ row }) => {
            return (
              <HStack>
                <Tooltip>
                  <TooltipTrigger>
                    <ItemReorderPolicy
                      reorderingPolicy={row.original.reorderingPolicy}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {getReorderPolicyDescription(row.original)}
                  </TooltipContent>
                </Tooltip>
              </HStack>
            );
          },
          header: t`Reorder Policy`,
          meta: {
            filter: {
              options: itemReorderingPolicies.map((policy) => ({
                label: <ItemReorderPolicy reorderingPolicy={policy} />,
                value: policy
              })),
              type: "static"
            },
            icon: <LuCircleCheck />
          }
        },
        {
          accessorKey: "replenishmentSystem",
          cell: (item) => (
            <Enumerable
              value={translateReplenishment(item.getValue<string>())}
            />
          ),
          header: t`Replenishment`,
          meta: {
            filter: {
              options: itemReplenishmentSystems.map((type) => ({
                label: <Enumerable value={translateReplenishment(type)} />,
                value: type
              })),
              type: "static"
            },
            icon: <LuLoaderCircle />
          }
        },

        {
          accessorKey: "usageLast30Days",
          cell: ({ row }) => formatNumber(row.original.usageLast30Days),
          header: t`Usage/Day (30d)`,
          meta: {
            formatter: formatNumber,
            icon: <LuCalculator />,
            renderTotal: true
          }
        },
        {
          accessorKey: "usageLast90Days",
          cell: ({ row }) => formatNumber(row.original.usageLast90Days),
          header: t`Usage/Day (90d)`,
          meta: {
            formatter: formatNumber,
            icon: <LuCalculator />,
            renderTotal: true
          }
        },
        {
          accessorKey: "quantityOnPurchaseOrder",
          cell: ({ row }) => formatNumber(row.original.quantityOnPurchaseOrder),
          header: t`On Purchase Order`,
          meta: {
            formatter: formatNumber,
            icon: <LuMoveUp className="text-emerald-500" />,
            renderTotal: true
          }
        },
        {
          accessorKey: "quantityOnProductionOrder",
          cell: ({ row }) =>
            formatNumber(row.original.quantityOnProductionOrder),
          header: t`On Jobs`,
          meta: {
            formatter: formatNumber,
            icon: <LuMoveUp className="text-emerald-500" />,
            renderTotal: true
          }
        },
        {
          accessorKey: "quantityOnProductionDemand",
          cell: ({ row }) =>
            formatNumber(row.original.quantityOnProductionDemand),
          header: t`On Jobs`,
          meta: {
            formatter: formatNumber,
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true
          }
        },
        {
          accessorKey: "quantityOnSalesOrder",
          cell: ({ row }) => formatNumber(row.original.quantityOnSalesOrder),
          header: t`On Sales Order`,
          meta: {
            formatter: formatNumber,
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true
          }
        },
        {
          accessorKey: "demandForecast",
          cell: ({ row }) => formatNumber(row.original.demandForecast),
          header: t`Demand Forecast`,
          meta: {
            formatter: formatNumber,
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true
          }
        },
        {
          accessorKey: "unitOfMeasureCode",
          cell: ({ row }) => {
            const unitOfMeasure = unitOfMeasures.find(
              (uom) => uom.value === row.original.unitOfMeasureCode
            );
            return (
              <Enumerable
                value={unitOfMeasure?.label ?? row.original.unitOfMeasureCode}
              />
            );
          },
          header: t`Unit of Measure`,
          meta: {
            icon: <LuRuler />
          }
        },
        {
          accessorKey: "materialFormId",
          cell: ({ row }) => {
            const form = forms.find(
              (f) => f.id === row.original.materialFormId
            );
            return <Enumerable value={form?.name ?? null} />;
          },
          header: t`Shape`,
          meta: {
            filter: {
              options: forms.map((form) => ({
                label: <Enumerable value={form.name} />,
                value: form.id
              })),
              type: "static"
            },
            icon: <LuShapes />
          }
        },
        {
          accessorKey: "materialSubstanceId",
          cell: ({ row }) => {
            const substance = substances.find(
              (s) => s.id === row.original.materialSubstanceId
            );
            return <Enumerable value={substance?.name ?? null} />;
          },
          header: t`Substance`,
          meta: {
            filter: {
              options: substances.map((substance) => ({
                label: <Enumerable value={substance.name ?? null} />,
                value: substance.id
              })),
              type: "static"
            },
            icon: <LuGlassWater />
          }
        },
        {
          accessorKey: "finish",
          cell: (item) => item.getValue(),
          header: t`Finish`,
          meta: {
            filter: {
              endpoint: path.to.api.materialFinishes(materialSubstanceId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  label: name,
                  value: name
                })) ?? [],
              type: "fetcher"
            },
            icon: <LuPaintBucket />
          }
        },
        {
          accessorKey: "grade",
          cell: (item) => item.getValue(),
          header: t`Grade`,
          meta: {
            filter: {
              endpoint: path.to.api.materialGrades(materialSubstanceId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  label: name,
                  value: name
                })) ?? [],
              type: "fetcher"
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "dimension",
          cell: (item) => item.getValue(),
          header: t`Dimension`,
          meta: {
            filter: {
              endpoint: path.to.api.materialDimensions(materialFormId),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  label: name,
                  value: name
                })) ?? [],
              type: "fetcher"
            },
            icon: <LuExpand />
          }
        },
        {
          accessorKey: "materialType",
          cell: (item) => item.getValue(),
          header: t`Type`,
          meta: {
            filter: {
              endpoint: path.to.api.materialTypes(
                materialSubstanceId,
                materialFormId
              ),
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ id, name }) => ({
                  label: name,
                  value: id
                })) ?? [],
              type: "fetcher"
            },
            icon: <LuPuzzle />
          }
        },
        {
          accessorKey: "type",
          cell: ({ row }) =>
            row.original.type && (
              <HStack>
                <MethodItemTypeIcon type={row.original.type} />
                <span>{row.original.type}</span>
              </HStack>
            ),
          header: t`Item Type`,
          meta: {
            filter: {
              options: itemTypes.map((type) => ({
                label: (
                  <HStack spacing={2}>
                    <MethodItemTypeIcon type={type} />
                    <span>{type}</span>
                  </HStack>
                ),
                value: type
              })),
              type: "static"
            },
            icon: <LuBox />
          }
        },
        {
          accessorKey: "tags",
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {/* @ts-expect-error TS2339 */}
              {(row.original.tags || []).map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </HStack>
          ),
          header: t`Tags`,
          meta: {
            filter: {
              isArray: true,
              options: tags?.map((tag) => ({
                label: <Badge variant="secondary">{tag}</Badge>,
                value: tag
              })),
              type: "static"
            },
            icon: <LuTag />
          }
        },
        {
          accessorKey: "storageTypeIds",
          cell: ({ row }) => {
            const ids =
              (
                row.original as InventoryItem & {
                  storageTypeIds?: string[] | null;
                }
              ).storageTypeIds ?? [];
            return (
              <HStack spacing={0} className="gap-1">
                {ids.map((id) => {
                  const st = (storageTypes ?? []).find((s) => s.id === id);
                  return <Enumerable key={id} value={st?.name ?? null} />;
                })}
              </HStack>
            );
          },
          header: t`Storage Type`,
          meta: {
            filter: {
              isArray: true,
              options: (storageTypes ?? []).map((st) => ({
                label: <Enumerable value={st.name} />,
                value: st.id
              })),
              type: "static"
            },
            icon: <LuWarehouse />,
            pluralHeader: t`Storage Types`
          }
        },
        {
          accessorKey: "storageUnitIds",
          cell: ({ row }) => {
            const ids =
              (
                row.original as InventoryItem & {
                  storageUnitIds?: string[] | null;
                }
              ).storageUnitIds ?? [];
            return (
              <HStack spacing={0} className="gap-1">
                {ids.map((id) => {
                  const opt = storageUnitOptions.find((o) => o.value === id);
                  const label = typeof opt?.label === "string" ? opt.label : id;
                  return <Enumerable key={id} value={label} />;
                })}
              </HStack>
            );
          },
          header: t`Storage Unit`,
          meta: {
            filter: {
              endpoint: path.to.api.storageUnits(locationId),
              isArray: true,
              type: "fetcher"
            },
            icon: <LuBoxes />,
            pluralHeader: t`Storage Units`
          }
        },
        {
          accessorKey: "active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          header: t`Active`,
          meta: {
            filter: {
              options: [
                { label: "Active", value: "true" },
                { label: "Inactive", value: "false" }
              ],
              type: "static"
            },
            icon: <LuCheck />,
            pluralHeader: t`Active Statuses`
          }
        }
      ];
    }, [
      forms,
      locationId,
      materialFormId,
      materialSubstanceId,
      formatNumber,
      params,
      substances,
      tags,
      storageTypes,
      storageUnitOptions,
      unitOfMeasures,
      t,
      translateReplenishment
    ]);

    const defaultColumnVisibility = {
      active: false,
      dimension: false,
      finish: false,
      grade: false,
      materialType: false,
      storageTypeIds: false,
      storageUnitIds: false,
      tags: false,
      type: false
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"]
    };

    const mrpFetcher = useFetcher<typeof mrpAction>();

    return (
      <Table<InventoryItem>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <mrpFetcher.Form method="post" action={path.to.api.mrp(locationId)}>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    type="submit"
                    variant="secondary"
                    rightIcon={<LuCirclePlay />}
                    isDisabled={mrpFetcher.state !== "idle"}
                    isLoading={mrpFetcher.state !== "idle"}
                  >
                    <Trans>Recalculate</Trans>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t`MRP runs automatically every 3 hours, but you can run it manually here.`}
                </TooltipContent>
              </Tooltip>
            </mrpFetcher.Form>
          </div>
        }
        title={t`Inventory`}
        table="inventory"
        withSavedView
      />
    );
  }
);

InventoryTable.displayName = "InventoryTable";

export default InventoryTable;

function getLocationPath(locationId: string) {
  return `${path.to.inventory}?location=${locationId}`;
}
