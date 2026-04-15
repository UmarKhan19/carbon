import { ValidatedForm } from "@carbon/form";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuCircleDollarSign,
  LuDownload,
  LuHash,
  LuPanelRight,
  LuSquareUser,
  LuTag,
  LuUsers,
} from "react-icons/lu";
import { ItemThumbnail, Table } from "~/components";
import { DatePicker, Hidden, Number, Submit, TextArea } from "~/components/Form";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import { priceOverrideValidator } from "../pricing.models";
import { priceSourceTypes, type PriceListRow } from "../pricing.service";
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

    const activeScope = customerId
      ? ({ type: "customer", id: customerId } as const)
      : customerTypeId
        ? ({ type: "customerType", id: customerTypeId } as const)
        : null;

    const customerOptions = useMemo(
      () => customers.map((c) => ({ value: c.id, label: c.name })),
      [customers]
    );

    const customerTypeOptions = useMemo(
      () => customerTypes.map((ct) => ({ value: ct.value, label: ct.label })),
      [customerTypes]
    );

    const selectedCustomerName = useMemo(
      () => customers.find((c) => c.id === customerId)?.name ?? null,
      [customers, customerId]
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
          header: t`Part`,
          cell: ({ row }) => {
            const canEdit =
              !!activeScope && permissions.can("update", "sales");
            return (
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
                <HStack className="min-w-[180px] truncate" spacing={2}>
                  <ItemThumbnail
                    size="sm"
                    thumbnailPath={row.original.thumbnailPath}
                    type="Part"
                  />
                  <VStack spacing={0}>
                    <span>{row.original.partId}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {row.original.itemName}
                    </span>
                  </VStack>
                </HStack>
                {!activeScope ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          rightIcon={<LuPanelRight />}
                          variant="secondary"
                          className="flex-shrink-0 opacity-40 cursor-not-allowed"
                          size="sm"
                          isDisabled
                        >
                          <span>{t`Open`}</span>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t`Select a customer or customer type first`}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    rightIcon={<LuPanelRight />}
                    variant="secondary"
                    className="flex-shrink-0 transition-opacity duration-200 opacity-0 group-hover/hyperlink:opacity-100"
                    size="sm"
                    asChild
                  >
                    <span>{t`Open`}</span>
                  </Button>
                )}
              </div>
            );
          },
          meta: { icon: <LuHash /> },
        },
        {
          id: "customerId",
          header: t`Customer`,
          cell: () =>
            selectedCustomerName ? (
              <span className="text-sm truncate max-w-[140px]">
                {selectedCustomerName}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            filter: {
              type: "static",
              options: customerOptions,
            },
            icon: <LuSquareUser />,
          },
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
              options: customerTypeOptions,
            },
            pluralHeader: t`Customer Types`,
            icon: <LuUsers />,
          },
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
          cell: ({ row }) => (
            <span className="tabular-nums font-medium">
              {currencyFormatter.format(row.original.resolvedPrice)}
            </span>
          ),
          meta: { icon: <LuCircleDollarSign /> },
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
                label: s,
              })),
            },
            pluralHeader: t`Sources`,
            icon: <LuTag />,
          },
        },
      ];
      return cols;
    }, [
      activeScope,
      baseCurrency,
      currencyFormatter,
      customerOptions,
      customerTypeOptions,
      permissions,
      selectedCustomerName,
      selectedCustomerTypeName,
      t,
    ]);

    const csvHref = customerId
      ? `${path.to.api.salesPriceListCsv}?customerId=${customerId}`
      : customerTypeId
        ? `${path.to.api.salesPriceListCsv}?customerTypeId=${customerTypeId}`
        : undefined;

    return (
      <VStack spacing={0} className="h-full">
        <Table<PriceListRow>
          data={data}
          columns={columns}
          count={count}
          title={t`Price List`}
          primaryAction={
            csvHref && (
              <a
                href={csvHref}
                download
                className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <LuDownload className="size-4" />
                {t`Export CSV`}
              </a>
            )
          }
        />
        {editingRow && activeScope && (
          <PriceOverrideDrawer
            row={editingRow}
            scope={activeScope}
            currencyFormatter={currencyFormatter}
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

type OverrideScope =
  | { type: "customer"; id: string }
  | { type: "customerType"; id: string };

function PriceOverrideDrawer({
  row,
  scope,
  currencyFormatter,
  onClose,
}: {
  row: PriceListRow;
  scope: OverrideScope;
  currencyFormatter: Intl.NumberFormat;
  onClose: () => void;
}) {
  const { company } = useUser();

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
              customerId:
                scope.type === "customer" ? scope.id : undefined,
              customerTypeId:
                scope.type === "customerType" ? scope.id : undefined,
              overridePrice: row.isOverridden
                ? row.resolvedPrice
                : row.basePrice,
              validFrom: row.overrideValidFrom ?? undefined,
              validTo: row.overrideValidTo ?? undefined,
              notes: row.overrideNotes ?? undefined,
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>Price Override</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="itemId" />
              <Hidden name="customerId" />
              <Hidden name="customerTypeId" />
              <VStack spacing={4}>
                <HStack spacing={3} className="items-center py-1">
                  <ItemThumbnail
                    size="md"
                    thumbnailPath={row.thumbnailPath}
                    type="Part"
                  />
                  <VStack spacing={0}>
                    <span className="text-sm font-medium">
                      {row.partId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.itemName}
                    </span>
                  </VStack>
                </HStack>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">
                    Base Price
                  </p>
                  <p className="text-sm font-medium tabular-nums">
                    {currencyFormatter.format(row.basePrice)}
                  </p>
                </div>
                <Number
                  name="overridePrice"
                  label="Override Price"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD",
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
