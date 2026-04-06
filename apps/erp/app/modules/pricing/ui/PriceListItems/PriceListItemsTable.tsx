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
import { useMemo } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { New } from "~/components";
import Grid from "~/components/Grid";
import Hyperlink from "~/components/Hyperlink";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUrlParams
} from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail, PriceListItem } from "../../types";

type PriceListItemsTableProps = {
  data: PriceListItem[];
};

const PriceListItemsTable = ({ data }: PriceListItemsTableProps) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const formatter = useCurrencyFormatter();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );
  const permissionModule =
    routeData?.priceList?.type === "Purchase" ? "purchasing" : "sales";
  const canCreate = permissions.can("create", permissionModule);
  const canDelete = permissions.can("delete", permissionModule);

  const columns = useMemo<ColumnDef<PriceListItem>[]>(
    () => [
      {
        accessorKey: "itemId",
        header: "Target",
        cell: ({ row }) => {
          const r = row.original as any;
          let label: string;
          if (r.itemId) {
            const item = r.item;
            label = item ? `${item.readableId} — ${item.name}` : r.itemId;
          } else {
            const group = r.itemPostingGroup;
            label = group ? `Group: ${group.name}` : "—";
          }

          return (
            <HStack className="justify-between min-w-[100px]">
              <Hyperlink
                to={`${path.to.priceListItems(id)}/${row.original.id}?${params.toString()}`}
              >
                {label}
              </Hyperlink>
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
                      onClick={() =>
                        navigate(
                          `${path.to.priceListItems(id)}/${row.original.id}?${params.toString()}`
                        )
                      }
                    >
                      <DropdownMenuIcon icon={<LuPencil />} />
                      Edit Item
                    </DropdownMenuItem>
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

            const item = r.item;
            const baseCost = item?.itemCost?.[0]?.unitCost;
            let preview = "";
            if (baseCost != null && r.markupPercent != null) {
              const computed = baseCost * (1 + r.markupPercent);
              preview = ` → ${formatter.format(computed)}`;
            }

            return (
              <span className="text-muted-foreground">
                {base} {markup}
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
          <Grid<PriceListItem> data={data} columns={columns} canEdit={false} />
        </CardContent>
      </Card>
    </>
  );
};

export default PriceListItemsTable;
