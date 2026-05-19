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
  Employee,
  Hidden,
  Input,
  Location,
  NumberControlled,
  SelectControlled,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethods,
  fixedAssetValidator
} from "../../fixedAssets.models";

type AssetClassOption = {
  id: string;
  name: string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  residualValuePercent: number;
};

type FixedAssetFormProps = {
  initialValues: z.infer<typeof fixedAssetValidator>;
  assetClasses: AssetClassOption[];
  onClose: () => void;
};

const FixedAssetForm = ({
  initialValues,
  assetClasses,
  onClose
}: FixedAssetFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const [assetData, setAssetData] = useState({
    fixedAssetClassId: initialValues.fixedAssetClassId ?? "",
    depreciationMethod: initialValues.depreciationMethod ?? "",
    usefulLifeMonths: initialValues.usefulLifeMonths ?? 0,
    residualValuePercent: initialValues.residualValuePercent ?? 0,
    assetLifetimeUsage: initialValues.assetLifetimeUsage ?? 0
  });

  const onAssetClassChange = (
    selected: { value: string; label: string | JSX.Element } | null
  ) => {
    if (!selected) return;
    const assetClass = assetClasses.find((c) => c.id === selected.value);
    if (!assetClass) return;

    setAssetData((d) => ({
      ...d,
      fixedAssetClassId: assetClass.id,
      depreciationMethod: assetClass.depreciationMethod,
      usefulLifeMonths: assetClass.usefulLifeMonths,
      residualValuePercent: assetClass.residualValuePercent
    }));
  };

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
                <SelectControlled
                  name="fixedAssetClassId"
                  label="Asset Class"
                  options={assetClasses.map((c) => ({
                    label: <Enumerable value={c.name} />,
                    value: c.id
                  }))}
                  value={assetData.fixedAssetClassId}
                  onChange={onAssetClassChange}
                />
                <Input name="description" label="Description" />
                <Input name="serialNumber" label="Serial Number" />
                <SelectControlled
                  name="depreciationMethod"
                  label="Depreciation Method"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                  value={assetData.depreciationMethod}
                  onChange={(v) => {
                    if (v)
                      setAssetData((d) => ({
                        ...d,
                        depreciationMethod: v.value
                      }));
                  }}
                />
                <NumberControlled
                  name="usefulLifeMonths"
                  label="Useful Life (Months)"
                  minValue={1}
                  value={assetData.usefulLifeMonths}
                  onChange={(value) =>
                    setAssetData((d) => ({ ...d, usefulLifeMonths: value }))
                  }
                />
                <NumberControlled
                  name="residualValuePercent"
                  label="Residual Value %"
                  minValue={0}
                  maxValue={100}
                  value={assetData.residualValuePercent}
                  onChange={(value) =>
                    setAssetData((d) => ({ ...d, residualValuePercent: value }))
                  }
                />
                {assetData.depreciationMethod === "Units of Production" && (
                  <NumberControlled
                    name="assetLifetimeUsage"
                    label="Lifetime Usage (Units)"
                    minValue={0}
                    value={assetData.assetLifetimeUsage}
                    onChange={(value) =>
                      setAssetData((d) => ({ ...d, assetLifetimeUsage: value }))
                    }
                  />
                )}
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
