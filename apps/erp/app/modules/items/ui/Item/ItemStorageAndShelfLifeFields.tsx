import { useControlField } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import {
  NumberControlled,
  Process,
  Select,
  StorageUnit
} from "~/components/Form";
import { useSettings, useUser } from "~/hooks";
import { shelfLifeModes } from "../../items.models";

type ShelfLifeMode = (typeof shelfLifeModes)[number];

const ItemStorageAndShelfLifeFields = () => {
  const { t } = useLingui();
  const shelfLifeLabel = (mode: ShelfLifeMode) => {
    switch (mode) {
      case "NotManaged":
        return t`Not managed`;
      case "Fixed Duration":
        return t`Fixed duration`;
      case "Calculated":
        return t`Component minimum`;
      case "Set on Receipt":
        return t`Set on receipt`;
    }
  };
  // The storage-unit picker is scoped to the signed-in user's default
  // location. Items are company-wide - there's no item.locationId - so we
  // use the user's working warehouse as the context for the pick. The
  // server will derive the pickMethod.locationId from the chosen unit's
  // storageUnit.locationId (which is always set).
  const { defaults } = useUser();
  const userLocationId = defaults.locationId ?? undefined;

  // Seed value for the shelf-life days input. Company-level setting has a
  // DB default of 7, so this is always defined.
  const { defaultShelfLifeDays } = useSettings();

  // Shelf-life only makes sense for items with per-unit records (Serial or
  // Batch). For fungible tracking types (Inventory / Non-Inventory) there
  // is no batchNumber / serialNumber row to stamp an expiry on - the
  // validator rejects the combination, and the UI shouldn't offer it.
  const [itemTrackingType] = useControlField<string | undefined>(
    "itemTrackingType"
  );
  const shelfLifeApplicable =
    itemTrackingType === "Serial" || itemTrackingType === "Batch";

  // Track the currently-selected shelf-life mode so we can hide the fields
  // that only apply to Fixed Duration. Zod refines already reject setting them
  // in any other mode on submit, but the UI shouldn't invite the mistake.
  const [shelfLifeMode, setShelfLifeMode] = useControlField<
    ShelfLifeMode | undefined
  >("shelfLifeMode");
  const [shelfLifeDays, setShelfLifeDays] = useControlField<number | undefined>(
    "shelfLifeDays"
  );

  // Clear the days value when the user switches away from Fixed Duration.
  // The validator rejects days in any other mode, and leaving a stale
  // value in form state would silently fail validation on submit. The
  // 7-day default is seeded via NumberControlled's `value` prop below -
  // no seeding useEffect needed here.
  useEffect(() => {
    if (shelfLifeMode !== "Fixed Duration" && shelfLifeDays !== undefined) {
      setShelfLifeDays(undefined);
    }
  }, [shelfLifeMode, shelfLifeDays, setShelfLifeDays]);

  // When the user switches tracking type away from Serial/Batch, wipe any
  // shelf-life mode they previously selected so the form state doesn't
  // carry a stale value that the validator would reject on submit.
  useEffect(() => {
    if (!shelfLifeApplicable && shelfLifeMode !== undefined) {
      setShelfLifeMode(undefined);
    }
  }, [shelfLifeApplicable, shelfLifeMode, setShelfLifeMode]);

  return (
    <>
      <StorageUnit
        name="defaultStorageUnitId"
        label={t`Default Storage Unit`}
        locationId={userLocationId}
        disabled={!userLocationId}
        helperText={
          userLocationId
            ? undefined
            : t`Set your default location in profile settings to pick a storage unit.`
        }
      />
      {shelfLifeApplicable && (
        <>
          <Select
            name="shelfLifeMode"
            label={t`Shelf Life`}
            // Only the two "actively managed" modes appear in the dropdown.
            // Clearing the Select (via its X button) sends an empty value
            // which the server validator maps to "NotManaged", deleting any
            // existing itemShelfLife row. One control: pick a mode to
            // enable, clear to disable.
            options={shelfLifeModes
              .filter((mode) => mode !== "NotManaged")
              .map((mode) => ({
                label: shelfLifeLabel(mode),
                value: mode
              }))}
            placeholder={t`Not managed`}
          />
          {shelfLifeMode === "Fixed Duration" && (
            <>
              <NumberControlled
                name="shelfLifeDays"
                label={t`Shelf-life (days)`}
                minValue={1}
                value={shelfLifeDays ?? defaultShelfLifeDays}
              />
              <Process
                name="shelfLifeTriggerProcessId"
                label={t`Shelf-life trigger process`}
                helperText={t`Defaults to any operation that produces this item.`}
              />
            </>
          )}
        </>
      )}
    </>
  );
};

export default ItemStorageAndShelfLifeFields;
