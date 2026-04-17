import { ValidatedForm } from "@carbon/form";
import {
  Button,
  ChoiceCardGroup,
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
  useDisclosure,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuGlobe,
  LuHistory,
  LuSquareUser,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import type { z } from "zod";
import AuditLogDrawer from "~/components/AuditLog/AuditLogDrawer";
import { EditableNumber } from "~/components/Editable";
import {
  Boolean as BooleanField,
  Customer,
  CustomerType,
  DatePicker,
  Hidden,
  Item,
  Submit,
  TextArea
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { priceOverrideValidator } from "../../sales.models";
import type { PriceOverrideBreak } from "../../types";

type ScopeType = "customer" | "customerType" | "all";

type PriceOverrideFormProps = {
  initialValues: z.infer<typeof priceOverrideValidator>;
  initialBreaks?: PriceOverrideBreak[];
  initialScope?: ScopeType;
  onClose: () => void;
};

const PriceOverrideForm = ({
  initialValues,
  initialBreaks,
  initialScope,
  onClose
}: PriceOverrideFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const auditDisclosure = useDisclosure();

  const [scope, setScope] = useState<ScopeType>(() => {
    if (initialValues.customerId) return "customer";
    if (initialValues.customerTypeId) return "customerType";
    // Edit with no IDs = All Customers. Create honors URL-provided scope hint.
    if (initialValues.id) return "all";
    return initialScope ?? "customer";
  });

  const [breaks, setBreaks] = useState<PriceOverrideBreak[]>(() => {
    const seed =
      Array.isArray(initialBreaks) && initialBreaks.length > 0
        ? initialBreaks.map((b) => ({
            quantity: Number(b.quantity) || 0,
            overridePrice: Number(b.overridePrice) || 0
          }))
        : [{ quantity: 1, overridePrice: 0 }];
    return seed.sort((a, b) => a.quantity - b.quantity);
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  // Early-termination controls — only sales:delete can edit once live.
  const canTerminate = permissions.can("delete", "sales");
  const lifecycleLocked = isEditing && !canTerminate;

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
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <div className="flex items-center justify-between gap-2">
                <ModalDrawerTitle>
                  {isEditing ? t`Edit Price Override` : t`New Price Override`}
                </ModalDrawerTitle>
                {isEditing && initialValues.id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<LuHistory />}
                    onClick={auditDisclosure.onOpen}
                  >
                    {t`History`}
                  </Button>
                )}
              </div>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="breaks" value={JSON.stringify(breaks)} />
              <VStack spacing={4}>
                <Item
                  name="itemId"
                  label={t`Item`}
                  type="Part"
                  isReadOnly={isEditing}
                />

                <ChoiceCardGroup<ScopeType>
                  label={t`Apply To`}
                  value={scope}
                  onChange={setScope}
                  options={[
                    {
                      value: "customer",
                      title: t`Specific Customer`,
                      description: t`Override price for a single customer`,
                      icon: <LuSquareUser />
                    },
                    {
                      value: "customerType",
                      title: t`Customer Type`,
                      description: t`Override price for all customers of a type`,
                      icon: <LuUsers />
                    },
                    {
                      value: "all",
                      title: t`All Customers`,
                      description: t`Fallback price when no other override matches`,
                      icon: <LuGlobe />
                    }
                  ]}
                />

                {scope === "customer" && (
                  <>
                    <Customer
                      name="customerId"
                      label={t`Customer`}
                      isRequired
                    />
                    <Hidden name="customerTypeId" value="" />
                  </>
                )}

                {scope === "customerType" && (
                  <>
                    <CustomerType
                      name="customerTypeId"
                      label={t`Customer Type`}
                      isRequired
                    />
                    <Hidden name="customerId" value="" />
                  </>
                )}

                {scope === "all" && (
                  <>
                    <Hidden name="customerId" value="" />
                    <Hidden name="customerTypeId" value="" />
                  </>
                )}

                <PriceBreaks
                  breaks={breaks}
                  onChange={setBreaks}
                  baseCurrency={baseCurrency}
                  isDisabled={isDisabled}
                />

                <div className="grid grid-cols-2 gap-3 w-full">
                  <BooleanField
                    name="active"
                    label={t`Active`}
                    isDisabled={lifecycleLocked}
                  />
                  <BooleanField
                    name="applyRulesOnTop"
                    label={t`Apply pricing rules`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label={t`Valid From`} />
                  <DatePicker
                    name="validTo"
                    label={t`Valid To`}
                    isDisabled={lifecycleLocked}
                  />
                </div>

                <TextArea name="notes" label={t`Notes`} />
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
      {isEditing && initialValues.id && company?.id && (
        <AuditLogDrawer
          isOpen={auditDisclosure.isOpen}
          onClose={auditDisclosure.onClose}
          entityType="priceOverride"
          entityId={initialValues.id}
          companyId={company.id}
          planRestricted={false}
        />
      )}
    </ModalDrawerProvider>
  );
};

function PriceBreaks({
  breaks,
  onChange,
  baseCurrency,
  isDisabled
}: {
  breaks: PriceOverrideBreak[];
  onChange: React.Dispatch<React.SetStateAction<PriceOverrideBreak[]>>;
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
    onChange((prev) => {
      const maxQty = prev.reduce((m, b) => Math.max(m, b.quantity), 0);
      return [...prev, { quantity: maxQty + 1, overridePrice: 0 }];
    });
  }, [onChange]);

  // Grid mutation is a no-op — edits land via local state + form submit.
  const noOpMutation = useCallback(
    async (
      _accessorKey: string,
      _newValue: unknown,
      _row: PriceOverrideBreak
    ) =>
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
      overridePrice: EditableNumber(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const columns = useMemo<ColumnDef<PriceOverrideBreak>[]>(
    () => [
      {
        accessorKey: "quantity",
        header: t`Quantity`,
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
                      {t`Delete Price Break`}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "overridePrice",
        header: t`Override Price`,
        cell: ({ row }) => formatter.format(row.original.overridePrice)
      }
    ],
    [isDisabled, removeRow, formatter, t]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">{t`Price Breaks`}</span>
      <Grid<PriceOverrideBreak>
        data={breaks}
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

export default PriceOverrideForm;
