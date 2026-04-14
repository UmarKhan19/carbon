import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { EditableNumber } from "~/components/Editable";
import { CustomerType, Hidden, Submit } from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

type PriceBreakRow = {
  quantity: number;
  unitPrice: number;
};

type CustomerTypePriceBreakFormProps = {
  initialValues?: {
    customerTypeId?: string;
    customerTypeName?: string;
  };
  priceBreaks?: PriceBreakRow[];
};

const customerTypePriceBreakValidator = z.object({
  customerTypeId: z.string().min(1, "Customer type is required")
});

const CustomerTypePriceBreakForm = ({
  initialValues,
  priceBreaks: initialPriceBreaks = []
}: CustomerTypePriceBreakFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { t } = useLingui();
  const { itemId } = useParams();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  if (!itemId) throw new Error("itemId not found");

  const isEditing = !!initialValues?.customerTypeId;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const [priceBreaks, setPriceBreaks] =
    useState<PriceBreakRow[]>(initialPriceBreaks);

  const hasInvalidPriceBreaks = priceBreaks.some(
    (pb) => pb.quantity <= 0 || pb.unitPrice <= 0
  );

  const onClose = () => navigate(-1);

  const action = isEditing
    ? path.to.partSalePriceBreaks(itemId, initialValues!.customerTypeId!)
    : path.to.newCustomerTypePriceBreak(itemId);

  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success, fetcher.data?.message]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="md">
        <ValidatedForm
          defaultValues={{
            customerTypeId: initialValues?.customerTypeId ?? ""
          }}
          validator={customerTypePriceBreakValidator}
          method="post"
          action={action}
          className="flex flex-col h-full"
          fetcher={fetcher}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing
                ? t`Edit Price Breaks: ${initialValues?.customerTypeName}`
                : t`New Customer Type Price Breaks`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="priceBreaks" value={JSON.stringify(priceBreaks)} />

            <VStack spacing={4}>
              <CustomerType
                name="customerTypeId"
                label={t`Customer Type`}
                disabled={isEditing}
              />
              <PriceBreaks
                priceBreaks={priceBreaks}
                onChange={setPriceBreaks}
                baseCurrency={baseCurrency}
                isDisabled={isDisabled}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={
                  isDisabled ||
                  hasInvalidPriceBreaks ||
                  priceBreaks.length === 0 ||
                  fetcher.state !== "idle"
                }
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
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
  const { t } = useLingui();
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
        header: t`Min Quantity`,
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[80px]">
            <span>{row.original.quantity}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`Price break actions`}
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
                      <Trans>Delete Price Break</Trans>
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
        header: t`Unit Price`,
        cell: ({ row }) => formatter.format(row.original.unitPrice)
      }
    ],
    [isDisabled, removeRow, formatter, t]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">
        <Trans>Price Breaks</Trans>
      </span>
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

export default CustomerTypePriceBreakForm;
