import { Badge, CreatableCombobox, HStack, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  LuCircleDollarSign,
  LuDownload,
  LuHash,
  LuInfo,
  LuPackage,
  LuPencil,
  LuTag,
} from "react-icons/lu";
import { useFetcher, useSearchParams } from "react-router";
import { Hyperlink, Table } from "~/components";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import type { PriceListRow } from "../pricing.service";
import { PriceTracePopover } from "./PriceTracePopover";

type FilterMode = "customer" | "customerType";

type PriceListViewProps = {
  data: PriceListRow[];
  count: number;
  customerId: string | null;
  customerTypeId: string | null;
};

const PriceListView = memo(
  ({ data, count, customerId, customerTypeId }: PriceListViewProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const { company } = useUser();
    const baseCurrency = company?.baseCurrencyCode ?? "USD";
    const currencyFormatter = useCurrencyFormatter();
    const [searchParams, setSearchParams] = useSearchParams();
    const [customers] = useCustomers();
    const customerTypes = useCustomerTypes();

    const filterMode: FilterMode =
      searchParams.get("customerTypeId") ? "customerType" : "customer";

    const customerOptions = useMemo(
      () => customers.map((c) => ({ value: c.id, label: c.name })),
      [customers]
    );

    const customerTypeOptions = useMemo(
      () => customerTypes.map((ct) => ({ value: ct.value, label: ct.label })),
      [customerTypes]
    );

    const onFilterModeChange = useCallback(
      (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("customerId");
          next.delete("customerTypeId");
          next.delete("offset");
          return next;
        });
      },
      [setSearchParams]
    );

    const onCustomerChange = useCallback(
      (selected: string) => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("customerTypeId");
          if (selected) {
            next.set("customerId", selected);
          } else {
            next.delete("customerId");
          }
          next.delete("offset");
          return next;
        });
      },
      [setSearchParams]
    );

    const onCustomerTypeChange = useCallback(
      (selected: string) => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("customerId");
          if (selected) {
            next.set("customerTypeId", selected);
          } else {
            next.delete("customerTypeId");
          }
          next.delete("offset");
          return next;
        });
      },
      [setSearchParams]
    );

    // Determine which scope is active for inline editing
    const activeScope = customerId
      ? ({ type: "customer", id: customerId } as const)
      : customerTypeId
        ? ({ type: "customerType", id: customerTypeId } as const)
        : null;

    const columns = useMemo<ColumnDef<PriceListRow>[]>(() => {
      const cols: ColumnDef<PriceListRow>[] = [
        {
          accessorKey: "partId",
          header: t`Part ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.partSales(row.original.itemId)}>
              {row.original.partId}
            </Hyperlink>
          ),
          meta: { icon: <LuHash /> },
        },
        {
          accessorKey: "itemName",
          header: t`Name`,
          cell: ({ row }) => (
            <span className="truncate max-w-[200px]">
              {row.original.itemName}
            </span>
          ),
          meta: { icon: <LuPackage /> },
        },
        {
          id: "basePrice",
          header: t`Base Price`,
          cell: ({ row }) => (
            <span className="text-muted-foreground tabular-nums">
              {currencyFormatter.format(row.original.basePrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> },
        },
        {
          id: "resolvedPrice",
          header: t`Final Price`,
          cell: ({ row }) => {
            if (!activeScope) {
              return (
                <span className="tabular-nums">
                  {currencyFormatter.format(row.original.resolvedPrice)}
                </span>
              );
            }
            return (
              <InlineEditPrice
                row={row.original}
                scope={activeScope}
                currencyFormatter={currencyFormatter}
                canEdit={permissions.can("update", "sales")}
              />
            );
          },
          meta: { icon: <LuCircleDollarSign /> },
        },
        {
          id: "source",
          header: t`Source`,
          cell: ({ row }) => {
            const { isOverridden, trace } = row.original;
            const isTypeOverride = trace.some(
              (s) => s.step === "Type Override"
            );
            return (
              <HStack className="items-center gap-2">
                {isOverridden && isTypeOverride ? (
                  <Badge variant="blue">{t`Type Override`}</Badge>
                ) : isOverridden ? (
                  <Badge variant="yellow">{t`Override`}</Badge>
                ) : trace.some(
                    (s) => s.step === "Discount" || s.step === "Markup"
                  ) ? (
                  <Badge variant="default">{t`Rule`}</Badge>
                ) : (
                  <Badge variant="gray">{t`Base`}</Badge>
                )}
                <PriceTracePopover
                  priceListId={null}
                  priceListName={trace.length > 1 ? "Pricing" : null}
                  priceTrace={trace}
                  currencyCode={baseCurrency}
                />
              </HStack>
            );
          },
          meta: { icon: <LuTag /> },
        },
      ];
      return cols;
    }, [activeScope, baseCurrency, currencyFormatter, permissions, t]);

    const csvHref = customerId
      ? `${path.to.api.salesPriceListCsv}?customerId=${customerId}`
      : customerTypeId
        ? `${path.to.api.salesPriceListCsv}?customerTypeId=${customerTypeId}`
        : undefined;

    return (
      <VStack spacing={0} className="h-full">
        <div className="px-4 py-3 border-b border-border flex items-center gap-4">
          <select
            className="h-8 px-2 text-sm border border-border rounded bg-background"
            value={filterMode}
            onChange={onFilterModeChange}
          >
            <option value="customer">{t`Customer`}</option>
            <option value="customerType">{t`Customer Type`}</option>
          </select>
          <div className="w-[280px]">
            {filterMode === "customer" ? (
              <CreatableCombobox
                options={customerOptions}
                placeholder={t`Filter by customer...`}
                value={customerId ?? ""}
                onChange={onCustomerChange}
                isClearable
              />
            ) : (
              <CreatableCombobox
                options={customerTypeOptions}
                placeholder={t`Filter by customer type...`}
                value={customerTypeId ?? ""}
                onChange={onCustomerTypeChange}
                isClearable
              />
            )}
          </div>
          {!activeScope && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <LuInfo className="size-4" />
              {t`Select a customer or customer type to see resolved prices and enable editing`}
            </p>
          )}
          {csvHref && (
            <a
              href={csvHref}
              download
              className="ml-auto text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <LuDownload className="size-4" />
              {t`Export CSV`}
            </a>
          )}
        </div>
        <Table<PriceListRow>
          data={data}
          columns={columns}
          count={count}
          title={t`Price List`}
        />
      </VStack>
    );
  }
);

PriceListView.displayName = "PriceListView";
export default PriceListView;

// -- Inline Edit Component --

type OverrideScope =
  | { type: "customer"; id: string }
  | { type: "customerType"; id: string };

function InlineEditPrice({
  row,
  scope,
  currencyFormatter,
  canEdit,
}: {
  row: PriceListRow;
  scope: OverrideScope;
  currencyFormatter: Intl.NumberFormat;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.resolvedPrice));
  const inputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();

  const save = useCallback(() => {
    const numValue = Number(value);
    if (!Number.isFinite(numValue) || numValue < 0) {
      setValue(String(row.resolvedPrice));
      setEditing(false);
      return;
    }

    if (numValue !== row.resolvedPrice) {
      const formData: Record<string, string> = {
        itemId: row.itemId,
        overridePrice: String(numValue),
      };

      if (scope.type === "customer") {
        formData.customerId = scope.id;
      } else {
        formData.customerTypeId = scope.id;
      }

      fetcher.submit(formData, { method: "POST" });
    }
    setEditing(false);
  }, [fetcher, row.itemId, row.resolvedPrice, scope, value]);

  if (!canEdit) {
    return (
      <span className="tabular-nums">
        {currencyFormatter.format(row.resolvedPrice)}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        min="0"
        className="w-24 px-1.5 py-0.5 text-sm border border-ring rounded bg-background tabular-nums text-right ring-2 ring-ring"
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(String(row.resolvedPrice));
            setEditing(false);
          }
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      className="tabular-nums text-left hover:bg-muted px-1.5 py-0.5 rounded border border-transparent hover:border-border transition-colors cursor-text group"
      onClick={(e) => {
        e.stopPropagation();
        setValue(String(row.resolvedPrice));
        setEditing(true);
      }}
      title={
        scope.type === "customer"
          ? "Click to override price for this customer"
          : "Click to override price for this customer type"
      }
    >
      <span className="inline-flex items-center gap-1">
        {currencyFormatter.format(row.resolvedPrice)}
        <LuPencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </span>
    </button>
  );
}
