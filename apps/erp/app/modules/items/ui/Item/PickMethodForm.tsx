import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Combobox,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { z } from "zod";
import {
  Combobox as ComboboxFormField,
  CustomFormFields,
  Hidden,
  NumberControlled,
  Process,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  pickMethodWithShelfLifeValidator,
  shelfLifeModes
} from "../../items.models";

type ShelfLifeMode = (typeof shelfLifeModes)[number];

type PickMethodFormProps = {
  initialValues: z.infer<typeof pickMethodWithShelfLifeValidator>;
  locations: ListItem[];
  type: "Part" | "Material" | "Tool" | "Consumable";
  storageUnits: { value: string; label: string }[];
  /**
   * Used to decide whether to render the shelf-life controls. Shelf life
   * only makes sense for items with per-unit records (Serial / Batch)
   * since batchNumber / serialNumber are where the expiry date is stamped.
   * Fungible tracking types have no per-unit row, so the fields are hidden.
   */
  itemTrackingType: string;
};

const shelfLifeLabel = (mode: ShelfLifeMode) => {
  switch (mode) {
    case "NotManaged":
      return "Not managed";
    case "ItemSpecific":
      return "Item specific";
    case "Calculated":
      return "Calculated from BoM";
  }
};

const PickMethodForm = ({
  initialValues,
  locations,
  storageUnits,
  type,
  itemTrackingType
}: PickMethodFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id
  }));

  const shelfLifeApplicable =
    itemTrackingType === "Serial" || itemTrackingType === "Batch";

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={pickMethodWithShelfLifeValidator}
        defaultValues={initialValues}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Inventory</Trans>
            </CardTitle>
          </CardHeader>

          <CardAction>
            <Combobox
              asButton
              size="sm"
              value={initialValues.locationId}
              options={locationOptions}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(
                  initialValues.itemId,
                  selected,
                  type
                );
              }}
            />
          </CardAction>
        </HStack>

        <CardContent>
          <Hidden name="itemId" />
          <Hidden name="locationId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <ComboboxFormField
              name="defaultStorageUnitId"
              label={t`Default Storage Unit`}
              options={storageUnits}
              className="w-full"
            />

            {shelfLifeApplicable && <ShelfLifeFields />}

            <CustomFormFields table="partInventory" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PickMethodForm;

// Inline shelf-life controls for the Inventory card. Renders the mode
// Select, and on ItemSpecific, the days (defaulted to 7) + trigger process
// inputs. Clearing the Select submits as "NotManaged" which tells the
// server to delete any existing itemShelfLife row (see the route action).
function ShelfLifeFields() {
  const [shelfLifeMode] = useControlField<ShelfLifeMode | undefined>(
    "shelfLifeMode"
  );
  const [shelfLifeDays, setShelfLifeDays] = useControlField<number | undefined>(
    "shelfLifeDays"
  );

  // Keep the days value consistent with the mode: clear it when the user
  // switches away from ItemSpecific so the validator doesn't reject a
  // stale value on submit.
  useEffect(() => {
    if (shelfLifeMode !== "ItemSpecific" && shelfLifeDays !== undefined) {
      setShelfLifeDays(undefined);
    }
  }, [shelfLifeMode, shelfLifeDays, setShelfLifeDays]);

  return (
    <>
      <Select
        name="shelfLifeMode"
        label="Shelf-life management"
        options={shelfLifeModes
          .filter((mode) => mode !== "NotManaged")
          .map((mode) => ({
            label: shelfLifeLabel(mode),
            value: mode
          }))}
        placeholder="Not managed"
      />
      {shelfLifeMode === "ItemSpecific" && (
        <>
          <NumberControlled
            name="shelfLifeDays"
            label="Shelf-life (days)"
            minValue={1}
            value={shelfLifeDays ?? 7}
          />
          <Process
            name="shelfLifeTriggerProcessId"
            label="Shelf-life trigger process"
            helperText="Defaults to any operation that produces this item."
          />
        </>
      )}
    </>
  );
}

function getLocationPath(
  itemId: string,
  locationId: string,
  type: "Part" | "Material" | "Tool" | "Consumable"
) {
  switch (type) {
    case "Part":
      return `${path.to.partInventory(itemId)}?location=${locationId}`;
    case "Material":
      return `${path.to.materialInventory(itemId)}?location=${locationId}`;

    case "Tool":
      return `${path.to.toolInventory(itemId)}?location=${locationId}`;
    case "Consumable":
      return `${path.to.consumableInventory(itemId)}?location=${locationId}`;
    default:
      throw new Error(`Invalid item type: ${type}`);
  }
}
