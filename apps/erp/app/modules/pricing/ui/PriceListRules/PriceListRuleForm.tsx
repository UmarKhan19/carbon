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
  Tabs,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean as BooleanField,
  CustomerType,
  Hidden,
  Input,
  Item,
  ItemPostingGroup,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: consistent with codebase
  Number,
  Select,
  Submit,
  SupplierType
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  priceListRuleAmountTypes,
  priceListRuleTypes,
  priceListRuleValidator
} from "../../pricing.models";

type PriceListRuleFormProps = {
  initialValues: z.infer<typeof priceListRuleValidator>;
  priceListType?: string;
  onClose: () => void;
};

const PriceListRuleForm = ({
  initialValues,
  priceListType,
  onClose
}: PriceListRuleFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const [amountType, setAmountType] = useState(
    initialValues.amountType ?? "Percentage"
  );
  const [itemScope, setItemScope] = useState<"item" | "category">(
    initialValues.itemPostingGroupId ? "category" : "item"
  );

  const isEditing = initialValues.id !== undefined;
  const permissionModule =
    priceListType === "Purchase" ? "purchasing" : "sales";
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
                      (v?.value as "Percentage" | "Fixed") ?? "Percentage"
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
                  Scope (leave blank to apply to all)
                </p>

                <Number name="minQuantity" label="Min Quantity" />
                <Number name="maxQuantity" label="Max Quantity" />

                {priceListType === "Sales" && (
                  <CustomerType
                    name="customerTypeId"
                    label="Customer Type"
                    placeholder="All customer types"
                  />
                )}
                {priceListType === "Purchase" && (
                  <SupplierType
                    name="supplierTypeId"
                    label="Supplier Type"
                    placeholder="All supplier types"
                  />
                )}

                <div className="space-y-3">
                  <label className="text-sm font-medium">Item Scope</label>
                  <Tabs
                    value={itemScope}
                    onValueChange={(v) =>
                      setItemScope(v as "item" | "category")
                    }
                  >
                    <TabsList className="grid grid-cols-2 w-full">
                      <TabsTrigger value="item">Specific Item</TabsTrigger>
                      <TabsTrigger value="category">Item Group</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {itemScope === "item" ? (
                  <>
                    <input type="hidden" name="itemPostingGroupId" value="" />
                    <Item
                      name="itemId"
                      label="Item"
                      type="Item"
                      placeholder="All items"
                    />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="itemId" value="" />
                    <ItemPostingGroup
                      name="itemPostingGroupId"
                      label="Item Category"
                      placeholder="All categories"
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
