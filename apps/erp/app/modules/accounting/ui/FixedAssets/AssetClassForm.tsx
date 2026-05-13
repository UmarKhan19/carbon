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
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethods,
  fixedAssetClassValidator
} from "../../fixedAssets.models";

type AssetClassFormProps = {
  initialValues: z.infer<typeof fixedAssetClassValidator>;
  onClose: () => void;
};

const AssetClassForm = ({ initialValues, onClose }: AssetClassFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetClassValidator}
            method="post"
            action={
              isEditing
                ? path.to.assetClass(initialValues.id!)
                : path.to.newAssetClass
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Asset Class
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Input name="description" label="Description" />
                <Select
                  name="depreciationMethod"
                  label="Depreciation Method"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                />
                <Number
                  name="usefulLifeMonths"
                  label="Useful Life (Months)"
                  minValue={1}
                />
                <Number
                  name="residualValuePercent"
                  label="Residual Value %"
                  minValue={0}
                  maxValue={100}
                />
                <Account
                  name="assetAccountId"
                  label="Asset Account"
                  classes={["Asset"]}
                />
                <Account
                  name="accumulatedDepreciationAccountId"
                  label="Accumulated Depreciation Account"
                  classes={["Asset"]}
                />
                <Account
                  name="depreciationExpenseAccountId"
                  label="Depreciation Expense Account"
                  classes={["Expense"]}
                />
                <Account
                  name="writeOffAccountId"
                  label="Write-Off Account"
                  classes={["Expense"]}
                />
                <Account
                  name="writeDownAccountId"
                  label="Write-Down Account"
                  classes={["Expense"]}
                />
                <Account
                  name="disposalAccountId"
                  label="Disposal Account"
                  classes={["Revenue", "Expense"]}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
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

export default AssetClassForm;
