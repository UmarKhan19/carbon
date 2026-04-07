import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import { Hidden, Number, Submit } from "~/components/Form";
import Process from "~/components/Form/Process";
import ShelfLifeLabelType from "~/components/Form/ShelfLifeLabelType";
import StorageType from "~/components/Form/StorageType";
import { usePermissions } from "~/hooks";
import {
  itemShelfLifeValidator,
  type shelfLifeTriggerTypes
} from "../../items.models";

type StorageTypeOption = { id: string; name: string };
type LabelTypeOption = { id: string; name: string };

type ShelfLifeTrigger = (typeof shelfLifeTriggerTypes)[number];

const triggerOptions: { value: string; label: string }[] = [
  { value: "receipt", label: "Goods Receipt" },
  { value: "production_step", label: "Production Step" },
  { value: "cascading", label: "Cascading" }
];

type ItemShelfLifeFormProps = {
  initialValues: Partial<z.infer<typeof itemShelfLifeValidator>>;
  storageTypes: StorageTypeOption[];
  shelfLifeLabelTypes: LabelTypeOption[];
};

const ItemShelfLifeForm = ({
  initialValues,
  storageTypes,
  shelfLifeLabelTypes
}: ItemShelfLifeFormProps) => {
  const permissions = usePermissions();
  const [trigger, setTrigger] = useState<ShelfLifeTrigger>(
    initialValues.shelfLifeTrigger ?? "receipt"
  );

  const storageTypeOptions = storageTypes.map((st) => ({
    label: st.name,
    value: st.id
  }));

  const labelTypeOptions = shelfLifeLabelTypes.map((lt) => ({
    label: lt.name,
    value: lt.id
  }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemShelfLifeValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Shelf Life</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="shelfLife" />
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <SelectControlled
              name="shelfLifeTrigger"
              label="Trigger"
              options={triggerOptions}
              value={trigger}
              onChange={(option) => {
                if (option) setTrigger(option.value as ShelfLifeTrigger);
              }}
            />
            {trigger === "production_step" && (
              <Process name="triggerProcessId" label="Trigger Process" />
            )}
            {trigger !== "cascading" && (
              <Number
                name="totalShelfLifeDays"
                label="Total Shelf Life (Days)"
              />
            )}
            <Number
              name="commercialShelfLifeDays"
              label="Commercial Shelf Life (Days)"
            />
            <Number
              name="minRemainingShelfLifeDays"
              label="Min Remaining at Receipt (Days)"
            />
            <StorageType
              name="storageTypeId"
              label="Storage Type"
              options={storageTypeOptions}
              isClearable
            />
            <ShelfLifeLabelType
              name="shelfLifeLabelTypeId"
              label="Label Type"
              options={labelTypeOptions}
              isClearable
            />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemShelfLifeForm;
