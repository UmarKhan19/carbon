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
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuSquareUser, LuUsers } from "react-icons/lu";
import type { z } from "zod";
import {
  Boolean as BooleanField,
  ChoiceCardGroup,
  Customer,
  CustomerType,
  DatePicker,
  Hidden,
  Item,
  Number,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { priceOverrideValidator } from "../../sales.models";

type ScopeType = "customer" | "customerType";

type PriceOverrideFormProps = {
  initialValues: z.infer<typeof priceOverrideValidator>;
  onClose: () => void;
};

const PriceOverrideForm = ({
  initialValues,
  onClose
}: PriceOverrideFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();

  const [scope, setScope] = useState<ScopeType>(() => {
    if (initialValues.customerId) return "customer";
    if (initialValues.customerTypeId) return "customerType";
    return "customer";
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
            validator={priceOverrideValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Price Override` : t`New Price Override`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
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

                <Number
                  name="overridePrice"
                  label={t`Override Price`}
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />

                <BooleanField name="active" label={t`Active`} />

                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label={t`Valid From`} />
                  <DatePicker name="validTo" label={t`Valid To`} />
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
    </ModalDrawerProvider>
  );
};

export default PriceOverrideForm;
