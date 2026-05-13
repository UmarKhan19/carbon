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
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethods,
  fixedAssetValidator
} from "../../fixedAssets.models";

type FixedAssetFormProps = {
  initialValues: z.infer<typeof fixedAssetValidator>;
  assetClasses: { id: string; name: string }[];
  onClose: () => void;
};

const FixedAssetForm = ({
  initialValues,
  assetClasses,
  onClose
}: FixedAssetFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const fetcher = useFetcher();
  const [depreciationMethod, setDepreciationMethod] = useState(
    initialValues.depreciationMethod
  );

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
            validator={fixedAssetValidator}
            method="post"
            action={
              isEditing
                ? path.to.fixedAssetDetails(initialValues.id!)
                : path.to.newFixedAsset
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Fixed Asset
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Select
                  name="fixedAssetClassId"
                  label="Asset Class"
                  options={assetClasses.map((c) => ({
                    label: <Enumerable value={c.name} />,
                    value: c.id
                  }))}
                />
                <Input name="description" label="Description" />
                <Input name="serialNumber" label="Serial Number" />
                <Select
                  name="depreciationMethod"
                  label="Depreciation Method"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                  onChange={(v) => {
                    if (v)
                      setDepreciationMethod(
                        v.value as typeof depreciationMethod
                      );
                  }}
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
                {depreciationMethod === "Units of Production" && (
                  <Number
                    name="assetLifetimeUsage"
                    label="Lifetime Usage (Units)"
                    minValue={0}
                  />
                )}
                <Number
                  name="acquisitionCost"
                  label="Acquisition Cost"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <DatePicker name="acquisitionDate" label="Acquisition Date" />
                <DatePicker
                  name="depreciationStartDate"
                  label="Depreciation Start Date"
                />
                <Number
                  name="accumulatedDepreciation"
                  label="Accumulated Depreciation"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <Location name="locationId" label="Location" />
                <Employee name="custodianId" label="Custodian" />
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

export default FixedAssetForm;
