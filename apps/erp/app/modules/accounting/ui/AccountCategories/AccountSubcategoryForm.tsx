import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormLabel,
  HStack,
  Input as InputBase,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { accountSubcategoryValidator } from "../../accounting.models";
import type { AccountCategory } from "../../types";

type AccountSubcategoryFormProps = {
  initialValues: z.infer<typeof accountSubcategoryValidator>;
  onClose: () => void;
};

const AccountSubcategoryForm = ({
  initialValues,
  onClose
}: AccountSubcategoryFormProps) => {
  const { t } = useLingui();
  const params = useParams();
  const permissions = usePermissions();

  const { categoryId } = params;
  if (!categoryId) throw new Error("categoryId is not found");

  const routeData = useRouteData<{
    accountCategory: AccountCategory;
  }>(path.to.accountingCategoryList(categoryId));

  const category = routeData?.accountCategory.category ?? "";

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DrawerContent>
        <ValidatedForm
          validator={accountSubcategoryValidator}
          method="post"
          action={
            isEditing
              ? path.to.accountingSubcategory(initialValues.id!)
              : path.to.newAccountingSubcategory(categoryId)
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Account Subcategory</Trans>
              ) : (
                <Trans>New Account Subcategory</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="accountCategoryId" />
            <VStack>
              <FormControl>
                <FormLabel>
                  <Trans>Category</Trans>
                </FormLabel>
                <InputBase value={category} isReadOnly />
              </FormControl>
              <Input name="name" label={t`Name`} />
              <CustomFormFields table="accountSubcategory" />
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

export default AccountSubcategoryForm;
