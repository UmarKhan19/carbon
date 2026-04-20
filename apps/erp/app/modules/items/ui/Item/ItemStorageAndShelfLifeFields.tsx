import { useState } from "react";
import {
  Location,
  Number,
  Process,
  Radios,
  StorageUnit
} from "~/components/Form";
import { shelfLifeModes } from "../../items.models";

type ShelfLifeMode = (typeof shelfLifeModes)[number];

type ItemStorageAndShelfLifeFieldsProps = {
  /** Initial value for the location filter on the storage-unit selects. */
  initialLocationId?: string;
  /**
   * When true, Location + top-level Storage Unit are advertised as required.
   * Refines in the Zod validator do the real enforcement for inventory-tracked
   * item types (Part, Material, Consumable).
   */
  inventoryTracked?: boolean;
};

const shelfLifeLabel = (mode: ShelfLifeMode) => {
  switch (mode) {
    case "NotManaged":
      return "Not managed";
    case "ItemSpecific":
      return "Item-specific";
    case "Calculated":
      return "Calculated from BoM";
  }
};

const ItemStorageAndShelfLifeFields = ({
  initialLocationId,
  inventoryTracked = false
}: ItemStorageAndShelfLifeFieldsProps) => {
  const [locationId, setLocationId] = useState<string | undefined>(
    initialLocationId
  );

  const storageUnitLabelSuffix = inventoryTracked ? "" : " (optional)";

  return (
    <>
      <Location
        name="defaultLocationId"
        label={
          inventoryTracked ? "Default Location" : "Default Location (optional)"
        }
        onChange={(newValue) => setLocationId(newValue?.value ?? undefined)}
      />
      <StorageUnit
        name="defaultStorageUnitId"
        label={`Default Storage Unit${storageUnitLabelSuffix}`}
        locationId={locationId}
        isDisabled={!locationId}
      />
      <StorageUnit
        name="defaultNestedStorageUnitId"
        label="Default Nested Storage Unit (optional)"
        locationId={locationId}
        isDisabled={!locationId}
      />
      <Radios
        name="shelfLifeMode"
        label="Shelf-life management"
        options={shelfLifeModes.map((mode) => ({
          label: shelfLifeLabel(mode),
          value: mode
        }))}
      />
      <Number
        name="shelfLifeDays"
        label="Shelf-life (days)"
        minValue={1}
        helperText="Only applies when shelf-life is Item-specific. Leave blank for raw materials whose expiry is captured at Receipt."
      />
      <Process
        name="shelfLifeTriggerProcessId"
        label="Shelf-life trigger process"
        helperText="Optional. When set, the shelf-life clock starts only when an operation using this process completes (e.g. Harvest, Packaging, Pasteurisation). Leave blank to stamp on any production completion for this item."
      />
    </>
  );
};

export default ItemStorageAndShelfLifeFields;
