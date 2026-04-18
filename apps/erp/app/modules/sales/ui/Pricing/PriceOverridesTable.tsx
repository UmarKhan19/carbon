import {
  Badge,
  Button,
  HStack,
  Label,
  MenuIcon,
  MenuItem,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuChevronDown,
  LuChevronsUpDown,
  LuChevronUp,
  LuCircleDollarSign,
  LuCircleOff,
  LuGroup,
  LuPencil,
  LuPlus,
  LuTag,
  LuTrash
} from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router";
import { Hyperlink, ItemThumbnail, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
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
    const itemPostingGroups = useItemPostingGroups();

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
          accessorKey: "itemPostingGroupId",
          header: t`Item Group`,
          cell: ({ row }) => {
            const id = row.original.itemPostingGroupId;
            if (!id) return null;
            const group = itemPostingGroups.find((g) => g.value === id);
            return group ? <Enumerable value={group.label} /> : null;
          },
          meta: {
            filter: {
              type: "static",
              options: itemPostingGroups.map((group) => ({
                value: group.value,
                label: <Enumerable value={group.label} />
              }))
            },
            icon: <LuGroup />
          }
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
                <span>
                  {currencyFormatter.format(row.original.resolvedPrice)}
                </span>
                {row.original.isOverridden && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <LuCircleOff className="size-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>This price is overridden.</TooltipContent>
                  </Tooltip>
                )}
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
    }, [
      baseCurrency,
      buildOverrideHref,
      currencyFormatter,
      hasScope,
      itemPostingGroups,
      t
    ]);

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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" rightIcon={<LuChevronsUpDown />}>
                  {Number(previewQuantity) || 1}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="end">
                <Label>
                  <Trans>Quantity</Trans>
                </Label>
                <NumberField
                  value={Number(previewQuantity) || 1}
                  minValue={1}
                  onChange={(value) => {
                    if (Number.isFinite(value) && value >= 1) {
                      handleQuantityCommit(String(value));
                    }
                  }}
                  aria-label={t`Preview Quantity`}
                  className="w-24"
                >
                  <NumberInputGroup className="relative">
                    <NumberInput size="sm" min={1} />
                    <NumberInputStepper>
                      <NumberIncrementStepper>
                        <LuChevronUp size="1em" strokeWidth="3" />
                      </NumberIncrementStepper>
                      <NumberDecrementStepper>
                        <LuChevronDown size="1em" strokeWidth="3" />
                      </NumberDecrementStepper>
                    </NumberInputStepper>
                  </NumberInputGroup>
                </NumberField>
              </PopoverContent>
            </Popover>
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
