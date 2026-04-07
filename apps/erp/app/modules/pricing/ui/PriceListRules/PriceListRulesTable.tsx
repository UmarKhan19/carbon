import {
  Badge,
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
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUrlParams
} from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail, PriceListRule } from "../../types";

type PriceListRulesTableProps = {
  data: PriceListRule[];
};

const PriceListRulesTable = ({ data }: PriceListRulesTableProps) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );
  const permissionModule =
    routeData?.priceList?.type === "Purchase" ? "purchasing" : "sales";
  // Active price lists are immutable: editing requires creating a new version
  // first. This satisfies AC-ERP-08 (modifications generate new versions).
  const isLocked = routeData?.priceList?.status === "Active";
  const canEdit = permissions.can("update", permissionModule) && !isLocked;
  const canCreate = permissions.can("create", permissionModule) && !isLocked;
  const canDelete = permissions.can("delete", permissionModule) && !isLocked;

  const formatter = useCurrencyFormatter(
    routeData?.priceList?.currencyCode
      ? { currency: routeData.priceList.currencyCode }
      : undefined
  );

  const columns = useMemo<ColumnDef<PriceListRule>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Rule Name",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.name}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Rule actions"
                    icon={<LuEllipsisVertical />}
                    size="md"
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onClick={() =>
                      navigate(
                        `${path.to.priceListRules(id)}/${row.original.id}?${params.toString()}`
                      )
                    }
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    Edit Rule
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    disabled={!canDelete}
                    onClick={() =>
                      navigate(
                        `${path.to.priceListRules(id)}/delete/${row.original.id}?${params.toString()}`
                      )
                    }
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Rule
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        )
      },
      {
        accessorKey: "ruleType",
        header: "Type",
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.ruleType === "Discount" ? "default" : "secondary"
            }
          >
            {row.original.ruleType}
          </Badge>
        )
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: ({ row }) =>
          row.original.amountType === "Percentage"
            ? `${(row.original.amount * 100).toFixed(1)}%`
            : formatter.format(row.original.amount)
      },
      {
        id: "scope",
        header: "Scope",
        cell: ({ row }) => {
          const parts: string[] = [];
          if (row.original.minQuantity)
            parts.push(`Qty >= ${row.original.minQuantity}`);
          if (row.original.maxQuantity)
            parts.push(`Qty <= ${row.original.maxQuantity}`);
          if (row.original.customerTypeId) parts.push("Customer Type");
          if (row.original.supplierTypeId) parts.push("Supplier Type");
          if (row.original.itemId) parts.push("Item");
          if (row.original.itemPostingGroupId) parts.push("Category");
          return parts.length > 0 ? parts.join(", ") : "All";
        }
      },
      {
        accessorKey: "active",
        header: "Active",
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="default">Active</Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )
      }
    ],
    [canEdit, canDelete, navigate, id, params, formatter]
  );

  return (
    <>
      <Card className="w-full">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Rules</CardTitle>
          </CardHeader>
          <CardAction>
            {canCreate && (
              <New
                label="Rule"
                to={`${path.to.priceListRules(id)}/new?${params.toString()}`}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Grid<PriceListRule> data={data} columns={columns} canEdit={false} />
        </CardContent>
      </Card>
    </>
  );
};

export default PriceListRulesTable;
