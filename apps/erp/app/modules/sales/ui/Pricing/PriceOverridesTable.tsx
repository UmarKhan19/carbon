import {
  Badge,
  HStack,
  MenuIcon,
  MenuItem,
  NumberField,
  NumberInput,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleDollarSign,
  LuPencil,
  LuPlus,
  LuTag,
  LuTrash
} from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router";
import { Hyperlink, ItemThumbnail, New, Table } from "~/components";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import type { PriceListRow } from "~/modules/sales";
import { path } from "~/utils/path";
import { PriceListScopeEmpty } from "./PriceListScopeEmpty";
import { PriceTracePopover } from "./PriceTracePopover";
import {
  ALL_CUSTOMERS_SCOPE,
  type ScopeOption,
  ScopePicker
} from "./ScopePicker";

type PriceListTableProps = {
  data: PriceListRow[];
  count: number;
  scopeOptions: ScopeOption[];
  hasScope: boolean;
};

const sourceVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  Override: "default",
  "Type Override": "secondary",
  "All Override": "outline",
  Rule: "outline",
  Base: "outline"
};

const PriceListTable = memo(
  ({ data, count, scopeOptions, hasScope }: PriceListTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter();
    const { company } = useUser();
    const baseCurrency = company?.baseCurrencyCode ?? "USD";
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const previewQuantity = searchParams.get("quantity") ?? "1";

    const scopeId =
      searchParams.get("customerId") ??
      searchParams.get("customerTypeId") ??
      (searchParams.get("customerScope") === ALL_CUSTOMERS_SCOPE
        ? ALL_CUSTOMERS_SCOPE
        : "");

    const buildOverrideHref = useCallback(
      (row: PriceListRow) => {
        const next = new URLSearchParams(searchParams);
        next.set("itemId", row.itemId);
        if (row.overrideId) {
          return `${path.to.priceOverride(row.overrideId)}?${next.toString()}`;
        }
        return `${path.to.newPriceOverride}?${next.toString()}`;
      },
      [searchParams]
    );

    const handleScopeChange = useCallback(
      (selectedId: string) => {
        const next = new URLSearchParams(searchParams);
        next.delete("customerId");
        next.delete("customerTypeId");
        next.delete("customerScope");
        if (selectedId === ALL_CUSTOMERS_SCOPE) {
          next.set("customerScope", ALL_CUSTOMERS_SCOPE);
        } else if (selectedId) {
          const picked = scopeOptions.find((o) => o.value === selectedId);
          if (picked) {
            next.set(
              picked.helper === "Type" ? "customerTypeId" : "customerId",
              selectedId
            );
          }
        }
        setSearchParams(next);
      },
      [scopeOptions, searchParams, setSearchParams]
    );

    const columns = useMemo<ColumnDef<PriceListRow>[]>(() => {
      const cols: ColumnDef<PriceListRow>[] = [
        {
          accessorKey: "partId",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="min-w-[240px] items-center" spacing={2}>
              <ItemThumbnail
                size="md"
                thumbnailPath={row.original.thumbnailPath}
                type="Part"
              />
              <VStack spacing={0} className="leading-tight justify-center">
                {hasScope ? (
                  <Hyperlink to={buildOverrideHref(row.original)}>
                    {row.original.partId}
                  </Hyperlink>
                ) : (
                  <span className="truncate font-medium">
                    {row.original.partId}
                  </span>
                )}
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.itemName}
                </div>
              </VStack>
            </HStack>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          accessorKey: "basePrice",
          header: t`Base Price`,
          cell: ({ row }) => (
            <span className="text-muted-foreground tabular-nums">
              {currencyFormatter.format(row.original.basePrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> }
        }
      ];

      if (hasScope) {
        cols.push(
          {
            accessorKey: "resolvedPrice",
            header: t`Resolved Price`,
            cell: ({ row }) => (
              <HStack spacing={2} className="items-center">
                <span
                  className={`tabular-nums font-medium ${
                    row.original.isOverridden ? "text-emerald-600" : ""
                  }`}
                >
                  {currencyFormatter.format(row.original.resolvedPrice)}
                </span>
                <PriceTracePopover
                  trace={row.original.trace}
                  currencyCode={baseCurrency}
                />
              </HStack>
            ),
            meta: { icon: <LuCircleDollarSign /> }
          },
          {
            accessorKey: "source",
            header: t`Source`,
            cell: ({ row }) => (
              <Badge variant={sourceVariant[row.original.source] ?? "outline"}>
                {row.original.source}
              </Badge>
            ),
            meta: { icon: <LuTag /> }
          },
          {
            id: "validity",
            header: t`Valid Period`,
            cell: ({ row }) => {
              const { overrideValidFrom, overrideValidTo, isOverridden } =
                row.original;
              if (!isOverridden) {
                return <span className="text-muted-foreground">—</span>;
              }
              if (!overrideValidFrom && !overrideValidTo) {
                return (
                  <span className="text-muted-foreground text-sm">{t`Always`}</span>
                );
              }
              const from = overrideValidFrom
                ? formatDate(overrideValidFrom)
                : "…";
              const to = overrideValidTo ? formatDate(overrideValidTo) : "…";
              return <span className="text-sm">{`${from} – ${to}`}</span>;
            },
            meta: { icon: <LuCalendar /> }
          }
        );
      }

      return cols;
    }, [baseCurrency, buildOverrideHref, currencyFormatter, hasScope, t]);

    const handleQuantityCommit = useCallback(
      (raw: string) => {
        const parsed = Number(raw);
        const next = new URLSearchParams(searchParams);
        if (Number.isFinite(parsed) && parsed > 1) {
          next.set("quantity", String(parsed));
        } else {
          next.delete("quantity");
        }
        setSearchParams(next);
      },
      [searchParams, setSearchParams]
    );

    const renderContextMenu = useCallback(
      (row: PriceListRow) => {
        const canEdit = permissions.can(
          row.overrideId ? "update" : "create",
          "sales"
        );
        return (
          <>
            <MenuItem
              disabled={!canEdit || !hasScope}
              onClick={() => {
                navigate(buildOverrideHref(row));
              }}
            >
              <MenuIcon icon={row.overrideId ? <LuPencil /> : <LuPlus />} />
              {row.overrideId ? t`Edit Override` : t`Create Override`}
            </MenuItem>
            {row.overrideId && (
              <MenuItem
                destructive
                disabled={!permissions.can("delete", "sales")}
                onClick={() => {
                  navigate(
                    `${path.to.deletePriceOverride(
                      row.overrideId!
                    )}?${searchParams.toString()}`
                  );
                }}
              >
                <MenuIcon icon={<LuTrash />} />
                {t`Delete Override`}
              </MenuItem>
            )}
          </>
        );
      },
      [buildOverrideHref, hasScope, navigate, permissions, searchParams, t]
    );

    if (!hasScope) {
      return (
        <PriceListScopeEmpty
          scopeOptions={scopeOptions}
          value={scopeId}
          onChange={handleScopeChange}
        />
      );
    }

    return (
      <Table<PriceListRow>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          <div className="flex items-center gap-2">
            <ScopePicker
              size="sm"
              value={scopeId}
              options={scopeOptions}
              onChange={handleScopeChange}
            />
            <HStack
              spacing={1}
              className="items-center text-xs text-muted-foreground"
            >
              <span>{t`Qty`}</span>
              <NumberField
                value={Number(previewQuantity) || 1}
                minValue={1}
                onChange={(value) => {
                  if (Number.isFinite(value) && value >= 1) {
                    handleQuantityCommit(String(value));
                  }
                }}
                aria-label={t`Preview Quantity`}
                className="w-20"
              >
                <NumberInput size="sm" min={1} />
              </NumberField>
            </HStack>
            {permissions.can("create", "sales") && (
              <New
                label={t`Override`}
                to={`${path.to.newPriceOverride}?${searchParams.toString()}`}
              />
            )}
          </div>
        }
        renderContextMenu={renderContextMenu}
        title={t`Price List`}
      />
    );
  }
);

PriceListTable.displayName = "PriceListTable";
export default PriceListTable;
