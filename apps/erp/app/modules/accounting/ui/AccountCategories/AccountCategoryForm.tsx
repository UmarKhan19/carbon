import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountCategoryValidator,
  accountClassTypes,
  incomeBalanceTypes
} from "../../accounting.models";

type AccountCategoryFormProps = {
  initialValues: z.infer<typeof accountCategoryValidator>;
  onClose: () => void;
};

const AccountCategoryForm = ({
  initialValues,
  onClose
}: AccountCategoryFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={accountCategoryValidator}
          method="post"
          action={
            isEditing
              ? path.to.accountingCategory(initialValues.id!)
              : path.to.newAccountingCategory
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Account Category</Trans>
              ) : (
                <Trans>New Account Category</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack>
              <Input name="category" label={t`Category`} />
              <Select
                name="incomeBalance"
                label={t`Income Balance`}
                options={incomeBalanceTypes.map((incomeBalance) => ({
                  value: incomeBalance,
                  label: incomeBalance
                }))}
              />
              <Select
                name="class"
                label={t`Class`}
                options={accountClassTypes.map((accountClass) => ({
                  value: accountClass,
                  label: accountClass
                }))}
              />
              <CustomFormFields table="accountCategory" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
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

export default AccountCategoryForm;
