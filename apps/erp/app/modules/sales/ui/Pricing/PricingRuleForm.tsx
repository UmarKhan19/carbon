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
  Customers,
  CustomerTypes,
  DatePicker,
  Hidden,
  Input,
  ItemPostingGroup,
  Items,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  pricingRuleAmountTypes,
  pricingRuleTypes,
  pricingRuleValidator
} from "../../sales.models";

type ItemScopeType = "all" | "item" | "group";

type PricingRuleFormProps = {
  initialValues: z.infer<typeof pricingRuleValidator>;
  onClose: () => void;
};

const PricingRuleForm = ({ initialValues, onClose }: PricingRuleFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();

  const [ruleType, setRuleType] = useState<(typeof pricingRuleTypes)[number]>(
    initialValues.ruleType ?? "Discount"
  );
  const [amountType, setAmountType] = useState<
    (typeof pricingRuleAmountTypes)[number]
  >(initialValues.amountType ?? "Percentage");
  const [itemScope, setItemScope] = useState<ItemScopeType>(() => {
    if (initialValues.itemIds && initialValues.itemIds.length > 0)
      return "item";
    if (initialValues.itemPostingGroupId) return "group";
    return "all";
  });
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

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
            validator={pricingRuleValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Pricing Rule
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Select
                  name="ruleType"
                  label="Rule Type"
                  options={pricingRuleTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                  onChange={(v) => {
                    if (v)
                      setRuleType(v.value as (typeof pricingRuleTypes)[number]);
                  }}
                />
                <Select
                  name="amountType"
                  label="Amount Type"
                  options={pricingRuleAmountTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                  onChange={(v) => {
                    if (v)
                      setAmountType(
                        v.value as (typeof pricingRuleAmountTypes)[number]
                      );
                  }}
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

                <Customers
                  name="customerIds"
                  label="Customers"
                  placeholder="All customers"
                />

                <CustomerTypes
                  name="customerTypeIds"
                  label="Customer Types"
                  placeholder="All customer types"
                />

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

                <ChoiceCardGroup<ItemScopeType>
                  label="Item Scope"
                  value={itemScope}
                  onChange={setItemScope}
                  options={[
                    {
                      value: "all",
                      title: "All Items",
                      description: "Rule applies to every item.",
                      icon: <LuLayers />
                    },
                    {
                      value: "item",
                      title: "Specific Items",
                      description: "Target one or more items.",
                      icon: <LuPackage />
                    },
                    {
                      value: "group",
                      title: "Item Group",
                      description: "Target an item group.",
                      icon: <LuBoxes />
                    }
                  ]}
                />

                {itemScope === "item" && (
                  <Items
                    name="itemIds"
                    label="Items"
                    placeholder="Select items"
                  />
                )}
                {itemScope === "group" && (
                  <ItemPostingGroup
                    name="itemPostingGroupId"
                    label="Item Group"
                  />
                )}

                {ruleType === "Markup" && (
                  <>
                    <Select
                      name="formulaBase"
                      label="Compute From"
                      placeholder="Base price (default)"
                      options={[
                        { label: "Item Cost", value: "cost" },
                        { label: "Item Sale Price", value: "salePrice" }
                      ]}
                    />
                    <Number
                      name="minMarginPercent"
                      label="Min Margin %"
                      helperText="Floor: price won't drop below this margin over cost"
                      minValue={0}
                      maxValue={1}
                      step={0.01}
                      formatOptions={{
                        style: "percent",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      }}
                    />
                  </>
                )}
                {ruleType !== "Markup" && (
                  <>
                    <Hidden name="formulaBase" value="" />
                    <Hidden name="minMarginPercent" value="" />
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

export default PricingRuleForm;
