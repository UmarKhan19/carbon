import { Badge, HStack, MenuIcon, MenuItem, VStack } from "@carbon/react";
import { formatDate, getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleDollarSign,
  LuPencil,
  LuSquareUser,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, ItemThumbnail, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, usePermissions, useUrlParams } from "~/hooks";
import { useCustomers } from "~/stores";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

type PriceOverride = {
  id: string;
  customerId: string | null;
  customerTypeId: string | null;
  itemId: string;
  overridePrice: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  createdAt: string;
  customer?: { id: string; name: string } | null;
  customerType?: { id: string; name: string } | null;
  item?: {
    id: string;
    name: string;
    unitSalePrice?: { unitSalePrice: number }[] | null;
  } | null;
};

type PriceOverridesTableProps = {
  data: PriceOverride[];
  count: number;
};

const PriceOverridesTable = memo(
  ({ data, count }: PriceOverridesTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter();
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const [items] = useItems();
    const [customers] = useCustomers();

    const columns = useMemo<ColumnDef<PriceOverride>[]>(() => {
      const cols: ColumnDef<PriceOverride>[] = [
        {
          accessorKey: "itemId",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
              <ItemThumbnail size="md" type="Part" />
              <VStack spacing={0}>
                <span className="truncate font-medium">
                  {getItemReadableId(items, row.original.itemId)}
                </span>
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.item?.name}
                </div>
              </VStack>
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options:
                items?.map((item) => ({
                  value: item.id,
                  label: item.readableIdWithRevision
                })) ?? []
            },
            icon: <LuBookMarked />
          }
        },
        {
          id: "customerId",
          header: t`Customer`,
          cell: ({ row }) =>
            row.original.customer ? (
              <CustomerAvatar customerId={row.original.customerId!} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            filter: {
              type: "static",
              options: customers?.map((customer) => ({
                value: customer.id,
                label: customer.name
              }))
            },
            icon: <LuSquareUser />
          }
        },
        {
          id: "customerTypeId",
          header: t`Customer Type`,
          cell: ({ row }) =>
            row.original.customerType ? (
              <Enumerable value={row.original.customerType.name} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            filter: {
              type: "fetcher",
              endpoint: path.to.api.customerTypes,
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ id, name }) => ({
                  value: id,
                  label: <Enumerable value={name} />
                })) ?? []
            },
            icon: <LuSquareUser />
          }
        },
        {
          id: "scope",
          header: t`Applies To`,
          cell: ({ row }) => {
            if (row.original.customerId && row.original.customer) {
              return <CustomerAvatar customerId={row.original.customerId} />;
            }
            if (row.original.customerTypeId && row.original.customerType) {
              return <Enumerable value={row.original.customerType.name} />;
            }
            return <span className="text-muted-foreground">—</span>;
          },
          meta: {
            icon: <LuSquareUser />,
            pluralHeader: t`Customer / Type`
          }
        },
        {
          id: "basePrice",
          header: t`Base Price`,
          cell: ({ row }) => (
            <span className="text-muted-foreground tabular-nums">
              {row.original.item?.unitSalePrice?.[0]?.unitSalePrice
                ? currencyFormatter.format(
                    row.original.item.unitSalePrice[0].unitSalePrice
                  )
                : "—"}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "overridePrice",
          header: t`Override Price`,
          cell: ({ row }) => (
            <span className="tabular-nums font-medium">
              {currencyFormatter.format(row.original.overridePrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "active",
          header: t`Status`,
          cell: ({ row }) => (
            <Badge variant={row.original.active ? "default" : "secondary"}>
              {row.original.active ? t`Active` : t`Inactive`}
            </Badge>
          )
        },
        {
          id: "validity",
          header: t`Valid Period`,
          cell: ({ row }) => {
            const { validFrom, validTo } = row.original;
            if (!validFrom && !validTo) {
              return (
                <span className="text-muted-foreground text-sm">{t`Always`}</span>
              );
            }
            const from = validFrom ? formatDate(validFrom) : "…";
            const to = validTo ? formatDate(validTo) : "…";
            return <span className="text-sm">{`${from} – ${to}`}</span>;
          },
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return cols;
    }, [currencyFormatter, customers, t, items]);

    const renderContextMenu = useCallback(
      (row: PriceOverride) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.priceOverride(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t`Edit Price Override`}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deletePriceOverride(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Price Override`}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    return (
      <Table<PriceOverride>
        data={data}
        columns={columns}
        count={count}
        defaultColumnVisibility={{
          customerId: false,
          customerTypeId: false
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label={t`Price Override`}
              to={`${path.to.newPriceOverride}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Price Overrides`}
      />
    );
  }
);

PriceOverridesTable.displayName = "PriceOverridesTable";
export default PriceOverridesTable;
