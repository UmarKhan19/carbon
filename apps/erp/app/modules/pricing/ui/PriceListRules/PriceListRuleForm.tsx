import { ValidatedForm } from "@carbon/form";
import {
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
import { useState } from "react";
import { LuBoxes, LuLayers, LuPackage } from "react-icons/lu";
import type { z } from "zod";
import {
  Boolean as BooleanField,
  ChoiceCardGroup,
  CustomerType,
  DatePicker,
  Hidden,
  Input,
  Item,
  ItemPostingGroup,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  priceListRuleAmountTypes,
  priceListRuleTypes,
  priceListRuleValidator
} from "../../pricing.models";

type PriceListRuleFormProps = {
  initialValues: z.infer<typeof priceListRuleValidator>;
  onClose: () => void;
};

type ItemScope = "all" | "item" | "category";

const PriceListRuleForm = ({
  initialValues,
  onClose
}: PriceListRuleFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const [amountType, setAmountType] = useState(
    initialValues.amountType ?? "Percentage"
  );
  const [itemScope, setItemScope] = useState<ItemScope>(() => {
    if (initialValues.itemPostingGroupId) return "category";
    if (initialValues.itemId) return "item";
    return "all";
  });

  const isEditing = initialValues.id !== undefined;
  const permissionModule = "sales";
  const isDisabled = isEditing
    ? !permissions.can("update", permissionModule)
    : !permissions.can("create", permissionModule);

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
            validator={priceListRuleValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "Add"} Pricing Rule
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="priceListId" />
              <VStack spacing={4}>
                <Input name="name" label="Rule Name" />
                <Select
                  name="ruleType"
                  label="Rule Type"
                  options={priceListRuleTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                />
                <Select
                  name="amountType"
                  label="Amount Type"
                  options={priceListRuleAmountTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                  onChange={(v) =>
                    setAmountType(
                      (v?.value as (typeof priceListRuleAmountTypes)[number]) ??
                        "Percentage"
                    )
                  }
                />

                {amountType === "Percentage" ? (
                  <Number
                    name="amount"
                    label="Amount"
                    minValue={0}
                    maxValue={1}
                    step={0.01}
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }}
                  />
                ) : (
                  <Number
                    name="amount"
                    label="Amount"
                    minValue={0}
                    formatOptions={{
                      style: "currency",
                      currency: company?.baseCurrencyCode ?? "USD"
                    }}
                  />
                )}

                <BooleanField name="active" label="Active" />

                <p className="text-sm font-medium text-muted-foreground pt-2">
                  Scope (optional)
                </p>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label="Valid From" />
                  <DatePicker name="validTo" label="Valid To" />
                </div>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <Number name="minQuantity" label="Min Qty" />
                  <Number name="maxQuantity" label="Max Qty" />
                </div>

                <CustomerType
                  name="customerTypeId"
                  label="Customer Type"
                  placeholder="All customer types"
                />

                <ChoiceCardGroup<ItemScope>
                  label="Item Scope"
                  value={itemScope}
                  onChange={setItemScope}
                  options={[
                    {
                      value: "all",
                      title: "All Items",
                      description:
                        "Rule applies to every item on this price list.",
                      icon: <LuLayers />
                    },
                    {
                      value: "item",
                      title: "Specific Item",
                      description: "Target one item by SKU.",
                      icon: <LuPackage />
                    },
                    {
                      value: "category",
                      title: "Item Group",
                      description: "Target an item group.",
                      icon: <LuBoxes />
                    }
                  ]}
                />

                {itemScope === "all" && (
                  <>
                    <input type="hidden" name="itemId" value="" />
                    <input type="hidden" name="itemPostingGroupId" value="" />
                  </>
                )}
                {itemScope === "item" && (
                  <>
                    <input type="hidden" name="itemPostingGroupId" value="" />
                    <Item name="itemId" label="Item" type="Item" />
                  </>
                )}
                {itemScope === "category" && (
                  <>
                    <input type="hidden" name="itemId" value="" />
                    <ItemPostingGroup
                      name="itemPostingGroupId"
                      label="Item Category"
                    />
                  </>
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

export default PriceListRuleForm;
