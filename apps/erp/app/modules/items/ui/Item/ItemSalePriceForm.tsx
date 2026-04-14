import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import { EditableNumber } from "~/components/Editable";
import { CustomFormFields, Hidden, Number, Submit } from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { itemUnitSalePriceValidator } from "../../items.models";

type PriceBreakRow = {
  quantity: number;
  unitPrice: number;
};

type ItemSalePriceFormProps = {
  initialValues: z.infer<typeof itemUnitSalePriceValidator>;
  priceBreaks?: PriceBreakRow[];
};

const ItemSalePriceForm = ({
  initialValues,
  priceBreaks: initialPriceBreaks = []
}: ItemSalePriceFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [priceBreaks, setPriceBreaks] =
    useState<PriceBreakRow[]>(initialPriceBreaks);

  const isDisabled = !permissions.can("update", "parts");

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemUnitSalePriceValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Sale Price</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <Hidden name="priceBreaks" value={JSON.stringify(priceBreaks)} />
          <VStack spacing={4}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
              <Number
                name="unitSalePrice"
                label="Unit Sale Price"
                minValue={0}
                formatOptions={{
                  style: "currency",
                  currency: baseCurrency
                }}
              />
              <CustomFormFields table="partUnitSalePrice" />
            </div>
            <PriceBreaks
              priceBreaks={priceBreaks}
              onChange={setPriceBreaks}
              baseCurrency={baseCurrency}
              isDisabled={isDisabled}
            />
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

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
      quantity: EditableNumber(noOpMutation),
      unitPrice: EditableNumber(noOpMutation, {
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

export default ItemSalePriceForm;
