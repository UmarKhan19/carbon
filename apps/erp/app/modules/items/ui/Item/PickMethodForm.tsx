import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ChoiceCardGroup,
  Combobox,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import {
  Combobox as ComboboxFormField,
  CustomFormFields,
  Hidden,
  NumberControlled,
  Process,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  pickMethodWithShelfLifeValidator,
  type shelfLifeModes
} from "../../items.models";

type ShelfLifeMode = (typeof shelfLifeModes)[number];
type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";

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
  /**
   * Filters the shelf-life mode options. `Make` items hide `SetAtReceipt`
   * (nothing is received), `Buy` items hide `Calculated` (no BoM is
   * consumed). `Buy and Make` / null keeps every mode.
   */
  replenishmentSystem: ReplenishmentSystem | null;
};

const PickMethodForm = ({
  initialValues,
  locations,
  storageUnits,
  type,
  itemTrackingType,
  replenishmentSystem
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

            {shelfLifeApplicable && (
              <ShelfLifeFields replenishmentSystem={replenishmentSystem} />
            )}

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

const ALL_SHELF_LIFE_MODES: ShelfLifeMode[] = [
  "ItemSpecific",
  "Calculated",
  "SetAtReceipt"
];

// The "has shelf life" checkbox is local state. When unchecked, the
// hidden input submits "", which the validator coerces to "NotManaged"
// (items.models.ts) so the service deletes the itemShelfLife row
// (items.service.ts upsertItemShelfLife).
function ShelfLifeFields({
  replenishmentSystem
}: {
  replenishmentSystem: ReplenishmentSystem | null;
}) {
  const { t } = useLingui();
  const shelfLifeOptionCopy: Record<
    Exclude<ShelfLifeMode, "NotManaged">,
    { title: string; description: string }
  > = {
    ItemSpecific: {
      title: t`Fixed Shelf Life`,
      description:
        replenishmentSystem === "Buy"
          ? t`Store a fixed number of days on this item. The expiry date is stamped on each batch or serial when it's received.`
          : replenishmentSystem === "Make"
            ? t`Store a fixed number of days on this item. The expiry date is stamped on each batch or serial when it's created (or when the trigger process runs, if set).`
            : t`Store a fixed number of days on this item. The expiry date is stamped on each batch or serial when it's received or created (or when the trigger process runs, if set).`
    },
    Calculated: {
      title: t`Inherit From Materials`,
      description: t`Take the shortest remaining shelf life across the materials consumed to make this item. Use when the product's expiry depends on its ingredients.`
    },
    SetAtReceipt: {
      title: t`Entered At Receipt`,
      description: t`A user records the expiry date on each batch or serial when the goods are received. Use when suppliers ship lots with different expiry dates.`
    }
  };
  const [shelfLifeMode, setShelfLifeMode] = useControlField<
    ShelfLifeMode | "" | undefined
  >("shelfLifeMode");
  const [shelfLifeDays, setShelfLifeDays] = useControlField<number | undefined>(
    "shelfLifeDays"
  );
  const [, setShelfLifeTriggerProcessId] = useControlField<string | undefined>(
    "shelfLifeTriggerProcessId"
  );

  const availableModes = useMemo<ShelfLifeMode[]>(() => {
    return ALL_SHELF_LIFE_MODES.filter((mode) => {
      if (replenishmentSystem === "Make" && mode === "SetAtReceipt")
        return false;
      if (replenishmentSystem === "Buy" && mode === "Calculated") return false;
      return true;
    });
  }, [replenishmentSystem]);

  const initialHasShelfLife = !!shelfLifeMode && shelfLifeMode !== "NotManaged";
  const [hasShelfLife, setHasShelfLife] = useState(initialHasShelfLife);

  // If the current mode isn't allowed by the replenishment system, fall
  // back to the first allowed option so the ChoiceCardGroup's controlled
  // value stays valid.
  useEffect(() => {
    if (
      hasShelfLife &&
      shelfLifeMode &&
      shelfLifeMode !== "NotManaged" &&
      !availableModes.includes(shelfLifeMode as ShelfLifeMode)
    ) {
      setShelfLifeMode(availableModes[0]);
    }
  }, [availableModes, hasShelfLife, shelfLifeMode, setShelfLifeMode]);

  useEffect(() => {
    if (shelfLifeMode !== "ItemSpecific" && shelfLifeDays !== undefined) {
      setShelfLifeDays(undefined);
    }
  }, [shelfLifeMode, shelfLifeDays, setShelfLifeDays]);

  // Buy-only items can't have a manufacturing trigger process — null it
  // out so a stale value from a prior replenishment setting doesn't persist.
  useEffect(() => {
    if (replenishmentSystem === "Buy") {
      setShelfLifeTriggerProcessId(undefined);
    }
  }, [replenishmentSystem, setShelfLifeTriggerProcessId]);

  const handleToggle = (next: boolean) => {
    setHasShelfLife(next);
    if (next) {
      const current = shelfLifeMode;
      if (
        !current ||
        current === "NotManaged" ||
        !availableModes.includes(current as ShelfLifeMode)
      ) {
        setShelfLifeMode(availableModes[0]);
      }
    } else {
      setShelfLifeMode("");
      setShelfLifeDays(undefined);
      setShelfLifeTriggerProcessId(undefined);
    }
  };

  const choiceValue: ShelfLifeMode =
    hasShelfLife && shelfLifeMode && shelfLifeMode !== "NotManaged"
      ? (shelfLifeMode as ShelfLifeMode)
      : availableModes[0];

  return (
    <>
      {/* Fills cols 2-3 of row 1 so the checkbox lands under Default Storage Unit. */}
      <div className="max-lg:hidden lg:col-span-2" aria-hidden="true" />

      <label
        htmlFor="hasShelfLife"
        className="flex items-center gap-2 cursor-pointer text-sm"
      >
        <Checkbox
          id="hasShelfLife"
          isChecked={hasShelfLife}
          onCheckedChange={(checked) => handleToggle(checked === true)}
        />
        <span>
          <Trans>Shelf-Life</Trans>
        </span>
        <input
          type="hidden"
          name="shelfLifeMode"
          value={hasShelfLife ? choiceValue : ""}
        />
      </label>

      {hasShelfLife && (
        <div className="lg:col-span-3">
          <ChoiceCardGroup<ShelfLifeMode>
            value={choiceValue}
            onChange={setShelfLifeMode}
            options={availableModes.map((mode) => ({
              value: mode,
              title: shelfLifeOptionCopy[mode].title,
              description: shelfLifeOptionCopy[mode].description
            }))}
          />
        </div>
      )}

      {hasShelfLife && choiceValue === "ItemSpecific" && (
        <>
          <NumberControlled
            name="shelfLifeDays"
            label={t`Shelf Life (Days)`}
            minValue={1}
            value={shelfLifeDays ?? 7}
          />
          {replenishmentSystem !== "Buy" && (
            <Process
              name="shelfLifeTriggerProcessId"
              label={t`Shelf Life Trigger Process`}
            />
          )}
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
