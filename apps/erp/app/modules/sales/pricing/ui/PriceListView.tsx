import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useEffect, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCircleDollarSign,
  LuPanelRight,
  LuSquareUser,
  LuTag,
  LuUsers
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { CustomerAvatar, ItemThumbnail, Table } from "~/components";
import {
  Customer,
  DatePicker,
  Item,
  Number,
  Submit,
  TextArea
} from "~/components/Form";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import { priceOverrideValidator } from "../pricing.models";
import { type PriceListRow, priceSourceTypes } from "../pricing.service";
import { PriceTracePopover } from "./PriceTracePopover";

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
    const [customers] = useCustomers();
    const customerTypes = useCustomerTypes();
    const [editingRow, setEditingRow] = useState<PriceListRow | null>(null);

    const canEdit = permissions.can("update", "sales");

    const customerOptions = useMemo(
      () => customers.map((c) => ({ value: c.id, label: c.name })),
      [customers]
    );

    const customerTypeOptions = useMemo(
      () => customerTypes.map((ct) => ({ value: ct.value, label: ct.label })),
      [customerTypes]
    );

    const selectedCustomerTypeName = useMemo(
      () =>
        customerTypes.find((ct) => ct.value === customerTypeId)?.label ?? null,
      [customerTypes, customerTypeId]
    );

    const columns = useMemo<ColumnDef<PriceListRow>[]>(() => {
      const cols: ColumnDef<PriceListRow>[] = [
        {
          accessorKey: "partId",
          header: t`Part ID`,
          cell: ({ row }) => (
            <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
              <ItemThumbnail
                size="md"
                thumbnailPath={row.original.thumbnailPath}
                type="Part"
              />
              <div
                role="button"
                tabIndex={0}
                className={`group/hyperlink text-foreground font-medium flex flex-row items-center justify-start gap-3 ${canEdit ? "cursor-pointer" : ""}`}
                onClick={() => {
                  if (canEdit) setEditingRow(row.original);
                }}
                onKeyDown={(e) => {
                  if (canEdit && (e.key === "Enter" || e.key === " "))
                    setEditingRow(row.original);
                }}
              >
                <span className="flex flex-row items-center gap-1">
                  <VStack spacing={0}>
                    <span className="truncate">{row.original.partId}</span>
                    <div className="w-full truncate text-muted-foreground text-xs">
                      {row.original.itemName}
                    </div>
                  </VStack>
                </span>
                {canEdit && (
                  <Button
                    rightIcon={<LuPanelRight />}
                    variant="secondary"
                    className="flex-shrink-0 opacity-0 transition-opacity duration-200 group-hover/hyperlink:opacity-100 no-underline"
                    size="sm"
                  >
                    {t`Open`}
                  </Button>
                )}
              </div>
            </HStack>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          id: "customerId",
          header: t`Customer`,
          cell: () =>
            customerId ? (
              <CustomerAvatar customerId={customerId} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            filter: {
              type: "static",
              options: customerOptions
            },
            icon: <LuSquareUser />
          }
        },
        {
          id: "customerTypeId",
          header: t`Customer Type`,
          cell: () =>
            selectedCustomerTypeName ? (
              <Badge variant="outline">{selectedCustomerTypeName}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            filter: {
              type: "static",
              options: customerTypeOptions
            },
            pluralHeader: t`Customer Types`,
            icon: <LuUsers />
          }
        },
        {
          id: "basePrice",
          header: t`Base Price`,
          cell: ({ row }) => (
            <span className="text-muted-foreground tabular-nums">
              {currencyFormatter.format(row.original.basePrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          id: "resolvedPrice",
          header: t`Final Price`,
          cell: ({ row }) => (
            <span className="tabular-nums font-medium">
              {currencyFormatter.format(row.original.resolvedPrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "source",
          header: t`Source`,
          cell: ({ row }) => {
            const { source, trace } = row.original;
            const badgeVariant =
              source === "Override"
                ? "yellow"
                : source === "Type Override"
                  ? "blue"
                  : source === "Rule"
                    ? "default"
                    : "gray";
            return (
              <HStack className="items-center gap-2">
                <Badge variant={badgeVariant}>{source}</Badge>
                <PriceTracePopover
                  priceListId={null}
                  priceListName={trace.length > 1 ? "Pricing" : null}
                  priceTrace={trace}
                  currencyCode={baseCurrency}
                />
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: priceSourceTypes.map((s) => ({
                value: s,
                label: s
              }))
            },
            pluralHeader: t`Sources`,
            icon: <LuTag />
          }
        }
      ];
      return cols;
    }, [
      baseCurrency,
      canEdit,
      currencyFormatter,
      customerId,
      customerOptions,
      customerTypeOptions,
      permissions,
      selectedCustomerTypeName,
      t
    ]);

    // Pre-populate customer from filter (use first if multi-selected)
    const defaultCustomerId = customerId?.split(",")[0] ?? null;

    return (
      <VStack spacing={0} className="h-full">
        <Table<PriceListRow>
          data={data}
          columns={columns}
          count={count}
          title={t`Price List`}
        />
        {editingRow && (
          <PriceOverrideDrawer
            row={editingRow}
            defaultCustomerId={defaultCustomerId}
            onClose={() => setEditingRow(null)}
          />
        )}
      </VStack>
    );
  }
);

PriceListView.displayName = "PriceListView";
export default PriceListView;

// -- Override Drawer --

type OverrideFetcherData = {
  override: {
    id: string;
    overridePrice: number;
    validFrom: string | null;
    validTo: string | null;
    notes: string | null;
  } | null;
};

function PriceOverrideDrawer({
  row,
  defaultCustomerId,
  onClose
}: {
  row: PriceListRow;
  defaultCustomerId: string | null;
  onClose: () => void;
}) {
  const { company } = useUser();
  const overrideFetcher = useFetcher<OverrideFetcherData>();

  const handleCustomerChange = (
    option: { value: string; label: string | JSX.Element } | null
  ) => {
    if (option?.value) {
      overrideFetcher.load(
        `${path.to.api.salesCustomerOverride}?customerId=${option.value}&itemId=${row.itemId}`
      );
    }
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={priceOverrideValidator}
            method="post"
            defaultValues={{
              itemId: row.itemId,
              customerId: defaultCustomerId ?? undefined,
              overridePrice: row.isOverridden
                ? row.resolvedPrice
                : row.basePrice,
              validFrom: row.overrideValidFrom ?? undefined,
              validTo: row.overrideValidTo ?? undefined,
              notes: row.overrideNotes ?? undefined
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>Price Override</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <OverrideFieldSync
                fetcher={overrideFetcher}
                basePrice={row.basePrice}
              />
              <VStack spacing={4}>
                <div className="grid grid-cols-2 gap-3 w-full">
                  <Item
                    name="itemId"
                    type="Part"
                    value={row.itemId}
                    isReadOnly
                  />
                  <Number
                    name="basePrice"
                    label="Base Price"
                    value={row.basePrice}
                    isReadOnly
                    formatOptions={{
                      style: "currency",
                      currency: company?.baseCurrencyCode ?? "USD"
                    }}
                  />
                </div>
                <Customer name="customerId" onChange={handleCustomerChange} />
                <Number
                  name="overridePrice"
                  label="Override Price"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label="Valid From" />
                  <DatePicker name="validTo" label="Valid To" />
                </div>
                <TextArea name="notes" label="Notes" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}

/**
 * Syncs fetcher data into form fields when a customer is changed.
 * Must be rendered inside ValidatedForm.
 */
function OverrideFieldSync({
  fetcher,
  basePrice
}: {
  fetcher: ReturnType<typeof useFetcher<OverrideFetcherData>>;
  basePrice: number;
}) {
  const [, setPrice] = useControlField<number | undefined>("overridePrice");
  const [, setValidFrom] = useControlField<string | undefined>("validFrom");
  const [, setValidTo] = useControlField<string | undefined>("validTo");
  const [, setNotes] = useControlField<string | undefined>("notes");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    const override = fetcher.data.override;
    if (override) {
      setPrice(override.overridePrice);
      setValidFrom(override.validFrom ?? undefined);
      setValidTo(override.validTo ?? undefined);
      setNotes(override.notes ?? undefined);
    } else {
      setPrice(basePrice);
      setValidFrom(undefined);
      setValidTo(undefined);
      setNotes(undefined);
    }
  }, [
    fetcher.data,
    fetcher.state,
    basePrice,
    setPrice,
    setValidFrom,
    setValidTo,
    setNotes
  ]);

  return null;
}
