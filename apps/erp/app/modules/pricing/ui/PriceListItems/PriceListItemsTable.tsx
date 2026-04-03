import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { New } from "~/components";
import { EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUrlParams,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail, PriceListItem } from "../../types";
import PriceListItemBreaks from "./PriceListItemBreaks";

type PriceListItemsTableProps = {
  data: PriceListItem[];
};

const PriceListItemsTable = ({ data }: PriceListItemsTableProps) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const formatter = useCurrencyFormatter();
  const { carbon } = useCarbon();
  const { id: userId, company } = useUser();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );
  const permissionModule =
    routeData?.priceList?.type === "Purchase" ? "purchasing" : "sales";
  const canCreate = permissions.can("create", permissionModule);
  const canUpdate = permissions.can("update", permissionModule);
  const canDelete = permissions.can("delete", permissionModule);

  const onCellEdit = useCallback(
    async (accessorKey: string, value: unknown, row: PriceListItem) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("priceListItem")
        .update({
          [accessorKey]: value,
          updatedBy: userId
        })
        .eq("id", row.id!);
    },
    [carbon, userId]
  );

  const editableComponents = useMemo(
    () => ({
      unitPrice: EditableNumber<PriceListItem>(onCellEdit, {
        formatOptions: {
          style: "currency",
          currency: company?.baseCurrencyCode ?? "USD"
        }
      })
    }),
    [onCellEdit, company?.baseCurrencyCode]
  );

  const columns = useMemo<ColumnDef<PriceListItem>[]>(
    () => [
      {
        accessorKey: "itemId",
        header: "Target",
        cell: ({ row }) => {
          let label: string;
          let link: string | null = null;
          if (row.original.itemId) {
            const item = (row.original as any).item;
            label = item
              ? `${item.readableId} — ${item.name}`
              : row.original.itemId;
            link = path.to.part(row.original.itemId);
          } else {
            const group = (row.original as any).itemPostingGroup;
            label = group ? `Category: ${group.name}` : "—";
          }

          return (
            <HStack className="justify-between min-w-[100px]">
              {link ? (
                <Link
                  to={link}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {label}
                </Link>
              ) : (
                <span>{label}</span>
              )}
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Item actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      destructive
                      disabled={!canDelete}
                      onClick={() =>
                        navigate(
                          `${path.to.priceListItems(id)}/delete/${row.original.id}?${params.toString()}`
                        )
                      }
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Item
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </HStack>
          );
        }
      },
      {
        accessorKey: "unitPrice",
        header: "Price / Formula",
        cell: ({ row }) => {
          const r = row.original as any;
          if (r.pricingMethod === "Formula") {
            const base = r.formulaBase === "salePrice" ? "Sale Price" : "Cost";
            const markup = r.markupPercent
              ? `+${(r.markupPercent * 100).toFixed(0)}%`
              : "";
            const rounding = r.roundingPrecision
              ? `, round ${formatter.format(r.roundingPrecision)}`
              : "";

            // Live preview: compute result if we have cost data
            const item = r.item;
            const baseCost = item?.itemCost?.[0]?.unitCost;
            let preview = "";
            if (baseCost != null && r.markupPercent != null) {
              let computed = baseCost * (1 + r.markupPercent);
              if (r.roundingPrecision && r.roundingPrecision > 0) {
                computed =
                  Math.round(computed / r.roundingPrecision) *
                  r.roundingPrecision;
              }
              preview = ` → ${formatter.format(computed)}`;
            }

            return (
              <span className="text-muted-foreground">
                {base} {markup}
                {rounding}
                {preview && (
                  <span className="text-foreground font-medium">{preview}</span>
                )}
              </span>
            );
          }
          return formatter.format(row.original.unitPrice);
        }
      },
      {
        accessorKey: "unitOfMeasureCode",
        header: "UOM",
        cell: ({ row }) => row.original.unitOfMeasureCode ?? "—"
      },
      {
        id: "breaks",
        header: "Breaks",
        size: 80,
        cell: ({ row }) => {
          const breaks = (row.original as any).priceListItemBreak ?? [];
          if (breaks.length === 0) return "—";
          return (
            <span className="text-muted-foreground">
              {breaks.length} {breaks.length === 1 ? "tier" : "tiers"}
            </span>
          );
        }
      },
      {
        id: "margin",
        header: "Margin",
        cell: ({ row }) => {
          const item = (row.original as any).item;
          const unitCost = item?.itemCost?.[0]?.unitCost;
          if (unitCost === undefined || unitCost === null) return "—";
          const price = row.original.unitPrice;
          if (price <= 0) return "—";
          const margin = ((price - unitCost) / price) * 100;
          const color =
            margin > 20
              ? "text-green-600 dark:text-green-400"
              : margin > 0
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-red-600 dark:text-red-400";
          return <span className={color}>{margin.toFixed(1)}%</span>;
        }
      }
    ],
    [formatter, canDelete, navigate, id, params]
  );

  const renderExpandedRow = useCallback((row: PriceListItem): ReactNode => {
    const r = row as any;
    return (
      <PriceListItemBreaks
        priceListItemId={row.id!}
        initialBreaks={r.priceListItemBreak ?? []}
      />
    );
  }, []);

  return (
    <>
      <Card className="w-full">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardAction>
            {canCreate && (
              <New
                label="Item"
                to={`${path.to.priceListItems(id)}/new?${params.toString()}`}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Grid<PriceListItem>
            data={data}
            columns={columns}
            canEdit={canUpdate}
            editableComponents={editableComponents}
            renderExpandedRow={renderExpandedRow}
            onNewRow={
              canCreate
                ? () =>
                    navigate(
                      `${path.to.priceListItems(id)}/new?${params.toString()}`
                    )
                : undefined
            }
          />
        </CardContent>
      </Card>
    </>
  );
};

export default PriceListItemsTable;
