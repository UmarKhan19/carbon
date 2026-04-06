import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import { EditableNumber } from "~/components/Editable";
import {
  Hidden,
  Item,
  ItemPostingGroup,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: consistent with codebase
  Number,
  NumberControlled,
  Select,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import {
  formulaBases,
  priceListItemValidator,
  pricingMethods
} from "../../pricing.models";
import { toggleGroupClass, toggleItemClass } from "../shared";

type PriceBreakRow = {
  quantity: number;
  unitPrice: number;
};

type PriceListItemFormProps = {
  initialValues: z.infer<typeof priceListItemValidator>;
  initialBreaks?: PriceBreakRow[];
  priceListType?: string;
  onClose: () => void;
};

const PriceListItemForm = ({
  initialValues,
  initialBreaks,
  priceListType,
  onClose
}: PriceListItemFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();

  const [unitPrice, setUnitPrice] = useState(initialValues.unitPrice ?? 0);
  const [uom, setUom] = useState(initialValues.unitOfMeasureCode ?? "");
  const [pricingMethod, setPricingMethod] = useState(
    initialValues.pricingMethod ?? "Fixed"
  );
  const [formulaBase, setFormulaBase] = useState(
    initialValues.formulaBase ?? ""
  );
  const [markupPercent, setMarkupPercent] = useState(
    initialValues.markupPercent ?? 0
  );
  const [replenishmentSystem, setReplenishmentSystem] = useState<string>("");
  const [itemCostValue, setItemCostValue] = useState<number | null>(null);
  const [itemSalePriceValue, setItemSalePriceValue] = useState<number | null>(
    null
  );
  const [priceBreaks, setPriceBreaks] = useState<PriceBreakRow[]>(
    initialBreaks ?? []
  );
  const [itemScope, setItemScope] = useState<"item" | "category">(
    initialValues.itemPostingGroupId ? "category" : "item"
  );

  const formulaPreview = useMemo(() => {
    if (pricingMethod !== "Formula" || !formulaBase) return null;
    const base = formulaBase === "cost" ? itemCostValue : itemSalePriceValue;
    if (base === null || base === undefined) return null;
    return base * (1 + markupPercent);
  }, [
    pricingMethod,
    formulaBase,
    itemCostValue,
    itemSalePriceValue,
    markupPercent
  ]);

  const isEditing = initialValues.id !== undefined;
  const permissionModule =
    priceListType === "Purchase" ? "purchasing" : "sales";
  const isDisabled = isEditing
    ? !permissions.can("update", permissionModule)
    : !permissions.can("create", permissionModule);

  const onItemChange = async (value: { value: string } | null) => {
    const itemId = value?.value;
    if (!itemId || !carbon || !company?.id) {
      setReplenishmentSystem("");
      return;
    }

    const [itemResult, priceResult, costResult] = await Promise.all([
      carbon
        .from("item")
        .select("unitOfMeasureCode, replenishmentSystem")
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle(),
      carbon
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", itemId)
        .maybeSingle()
    ]);

    if (itemResult.data?.unitOfMeasureCode) {
      setUom(itemResult.data.unitOfMeasureCode);
    }
    if (itemResult.data?.replenishmentSystem) {
      setReplenishmentSystem(itemResult.data.replenishmentSystem);
    } else {
      setReplenishmentSystem("");
    }
    if (priceResult.data?.unitSalePrice) {
      setUnitPrice(priceResult.data.unitSalePrice);
      setItemSalePriceValue(priceResult.data.unitSalePrice);
    }
    setItemCostValue(costResult.data?.unitCost ?? null);
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
            validator={priceListItemValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "Add"} Price List Item
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="priceListId" />
              <input
                type="hidden"
                name="priceBreaks"
                value={JSON.stringify(
                  pricingMethod === "Price Breaks" ? priceBreaks : []
                )}
              />
              <VStack spacing={4}>
                <div className="space-y-3">
                  <label className="text-sm font-medium">Applies To</label>
                  <ToggleGroup
                    type="single"
                    value={itemScope}
                    onValueChange={(v) => {
                      if (v) setItemScope(v as "item" | "category");
                    }}
                    className={toggleGroupClass}
                  >
                    <ToggleGroupItem value="item" className={toggleItemClass}>
                      Specific Item
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="category"
                      className={toggleItemClass}
                    >
                      Item Group
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {itemScope === "item" ? (
                  <>
                    <input type="hidden" name="itemPostingGroupId" value="" />
                    <Item
                      name="itemId"
                      label="Item"
                      type="Item"
                      onChange={onItemChange}
                    />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="itemId" value="" />
                    <ItemPostingGroup
                      name="itemPostingGroupId"
                      label="Item Posting Group"
                    />
                  </>
                )}

                {itemScope === "item" &&
                  (replenishmentSystem === "Make" ||
                    replenishmentSystem === "Buy and Make") && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This item is manufactured in-house. Its unit cost may be
                      stale if a cost rollup hasn't been run since the last BOM
                      change.
                    </p>
                  )}

                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                  value={uom}
                  onChange={(v) => setUom(v?.value ?? "")}
                />

                <Select
                  name="pricingMethod"
                  label="Pricing Method"
                  options={pricingMethods.map((m) => ({
                    label:
                      m === "Fixed"
                        ? "Fixed Price"
                        : m === "Formula"
                          ? "Formula (Cost-Based)"
                          : "Price Breaks",
                    value: m
                  }))}
                  onChange={(v) =>
                    setPricingMethod((v?.value as string) ?? "Fixed")
                  }
                />

                {pricingMethod === "Fixed" && (
                  <>
                    <NumberControlled
                      name="unitPrice"
                      label="Unit Price"
                      value={unitPrice}
                      onChange={setUnitPrice}
                      formatOptions={{
                        style: "currency",
                        currency: company?.baseCurrencyCode ?? "USD"
                      }}
                    />
                  </>
                )}

                {pricingMethod === "Formula" && (
                  <>
                    <Select
                      name="formulaBase"
                      label="Base Price From"
                      options={formulaBases.map((b) => ({
                        label:
                          b === "cost"
                            ? "Item Cost (Unit Cost)"
                            : "Item Sale Price",
                        value: b
                      }))}
                      onChange={(v) =>
                        setFormulaBase((v?.value as string) ?? "")
                      }
                    />
                    <Select
                      name="markupPercent"
                      label="Markup %"
                      options={[
                        { label: "0%", value: "0" },
                        { label: "5%", value: "0.05" },
                        { label: "10%", value: "0.1" },
                        { label: "15%", value: "0.15" },
                        { label: "20%", value: "0.2" },
                        { label: "25%", value: "0.25" },
                        { label: "30%", value: "0.3" },
                        { label: "35%", value: "0.35" },
                        { label: "40%", value: "0.4" },
                        { label: "50%", value: "0.5" },
                        { label: "60%", value: "0.6" },
                        { label: "70%", value: "0.7" },
                        { label: "80%", value: "0.8" },
                        { label: "90%", value: "0.9" },
                        { label: "100%", value: "1" }
                      ]}
                      onChange={(v) =>
                        setMarkupPercent(
                          v?.value ? parseFloat(v.value as string) : 0
                        )
                      }
                    />
                    <Number
                      name="minMarginPercent"
                      label="Min Margin %"
                      helperText="Lowest price allowed after markup"
                      minValue={0}
                      maxValue={1}
                      step={0.01}
                      formatOptions={{
                        style: "percent",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      }}
                    />
                    {formulaPreview !== null && (
                      <div className="rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="text-muted-foreground">
                          Estimated price:{" "}
                        </span>
                        <span className="font-medium">
                          {new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: company?.baseCurrencyCode ?? "USD"
                          }).format(formulaPreview)}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {pricingMethod === "Price Breaks" && (
                  <PriceBreaks
                    priceBreaks={priceBreaks}
                    onChange={setPriceBreaks}
                    baseCurrency={company?.baseCurrencyCode ?? "USD"}
                    isDisabled={isDisabled}
                  />
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
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
};

// ---------------------------------------------------------------------------
// PriceBreaks — inline editable grid (matches SupplierPartForm pattern)
// ---------------------------------------------------------------------------

function PriceBreaks({
  priceBreaks,
  onChange,
  baseCurrency,
  isDisabled
}: {
  priceBreaks: PriceBreakRow[];
  onChange: React.Dispatch<React.SetStateAction<PriceBreakRow[]>>;
  baseCurrency: string;
  isDisabled: boolean;
}) {
  const formatter = useCurrencyFormatter();

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => [...prev, { quantity: 0, unitPrice: 0 }]);
  }, [onChange]);

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: PriceBreakRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber<PriceBreakRow>(noOpMutation),
      unitPrice: EditableNumber<PriceBreakRow>(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const columns = useMemo<ColumnDef<PriceBreakRow>[]>(
    () => [
      {
        accessorKey: "quantity",
        header: "Min Quantity",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[80px]">
            <span>{row.original.quantity}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Price break actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => removeRow(row.index)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Price Break
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => formatter.format(row.original.unitPrice)
      }
    ],
    [isDisabled, removeRow, formatter]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">Price Breaks</span>
      <Grid<PriceBreakRow>
        data={priceBreaks}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? addRow : undefined}
        contained={false}
      />
    </div>
  );
}

export default PriceListItemForm;
