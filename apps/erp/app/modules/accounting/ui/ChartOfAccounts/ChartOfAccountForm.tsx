import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack
} from "@carbon/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Boolean,
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountClassTypes,
  accountTypes,
  accountValidator,
  consolidatedRateTypes,
  incomeBalanceTypes
} from "../../accounting.models";
import type { AccountClass, AccountIncomeBalance } from "../../types";

type ChartOfAccountFormProps = {
  initialValues: z.infer<typeof accountValidator>;
  groupAccounts?: { id: string; number: string; name: string }[];
};

const ChartOfAccountForm = ({
  initialValues,
  groupAccounts = []
}: ChartOfAccountFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [incomeBalance, setIncomeBalance] = useState<AccountIncomeBalance>(
    initialValues.incomeBalance
  );
  const [accountClass, setAccountClass] = useState<AccountClass>(
    initialValues.class
  );

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
      <DrawerContent size="full">
        <ValidatedForm
          validator={accountValidator}
          method="post"
          action={
            isEditing
              ? path.to.chartOfAccount(initialValues.id!)
              : path.to.newChartOfAccount
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? `${initialValues.number}` : "New Account"}
            </DrawerTitle>
            {isEditing && (
              <DrawerDescription>{initialValues.name}</DrawerDescription>
            )}
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
              <Input name="number" label="Account Number" />
              <Input name="name" label="Name" />
              <Boolean name="isGroup" label="Is Group" />

              <Combobox
                name="parentId"
                label="Parent Account"
                options={groupAccounts.map((a) => ({
                  label: `${a.number} - ${a.name}`,
                  value: a.id
                }))}
              />

              <Combobox
                name="accountType"
                label="Account Type"
                options={accountTypes.map((t) => ({
                  label: t,
                  value: t
                }))}
              />

              <Combobox
                name="incomeBalance"
                label="Income/Balance"
                options={incomeBalanceTypes.map((ib) => ({
                  label: ib,
                  value: ib
                }))}
                value={incomeBalance}
                onChange={(newValue) => {
                  if (newValue)
                    setIncomeBalance(newValue.value as AccountIncomeBalance);
                }}
              />
              <Combobox
                name="class"
                label="Class"
                options={accountClassTypes.map((c) => ({
                  label: c,
                  value: c
                }))}
                value={accountClass}
                onChange={(newValue) => {
                  if (newValue) setAccountClass(newValue.value as AccountClass);
                }}
              />
              <Select
                name="consolidatedRate"
                label="Consolidated Rate"
                options={consolidatedRateTypes.map((c) => ({
                  label: c,
                  value: c
                }))}
              />
              <CustomFormFields table="account" />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ChartOfAccountForm;
