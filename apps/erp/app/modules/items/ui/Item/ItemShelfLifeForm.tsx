import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import type { z } from "zod";
import { Hidden, Number, Submit } from "~/components/Form";
import ShelfLifeLabelType from "~/components/Form/ShelfLifeLabelType";
import StorageType from "~/components/Form/StorageType";
import { usePermissions } from "~/hooks";
import { itemShelfLifeValidator } from "../../items.models";

type StorageTypeOption = { id: string; name: string };
type LabelTypeOption = { id: string; name: string };

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
            <Number name="totalShelfLifeDays" label="Total Shelf Life (Days)" />
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
