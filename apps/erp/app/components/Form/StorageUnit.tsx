// `<StorageUnit>` — the historical leaf/bin picker API. Delegates to the
// `CreatableCombobox`-based `StorageUnitSelect`:
// - with `name`     -> form-bound variant
// - with no `name`  -> controlled variant (`storageUnitId` + `onChange`)
//
// The hierarchical drill-down (`StorageUnitDrillSelect`) is a separate
// component used only by the Parent picker.

import type { ComboboxProps } from "@carbon/form";
import { forwardRef, useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getStorageUnitsList } from "~/modules/inventory";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  StorageUnitSelect,
  StorageUnitSelectControl
} from "./StorageUnitSelect";

type StorageUnitSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string;
  /** Per-item qty hints shown as option helper text when provided. */
  itemId?: string;
  /** Controlled value (used when `name` is absent). */
  storageUnitId?: string | null;
  inline?: boolean;
  onChange?: (storageUnit: ListItem | null) => void;
};

const StorageUnit = forwardRef<HTMLDivElement, StorageUnitSelectProps>(
  (props, _ref) => {
    const {
      name,
      storageUnitId,
      label,
      inline,
      locationId,
      itemId,
      isReadOnly,
      isOptional,
      onChange,
      ...rest
    } = props;

    // Controlled (non-form) usage: table cells / line editors that own the
    // value and update via `onChange`.
    if (!name) {
      return (
        <StorageUnitSelectControl
          locationId={locationId}
          value={storageUnitId}
          itemId={itemId}
          isReadOnly={isReadOnly}
          placeholder={
            typeof rest.placeholder === "string" ? rest.placeholder : undefined
          }
          onChange={(unit) => onChange?.(unit)}
        />
      );
    }

    return (
      <StorageUnitSelect
        name={name}
        label={label}
        inline={inline}
        helperText={
          typeof rest.helperText === "string" ? rest.helperText : undefined
        }
        locationId={locationId}
        itemId={itemId}
        isReadOnly={isReadOnly}
        isOptional={isOptional}
        placeholder={
          typeof rest.placeholder === "string" ? rest.placeholder : undefined
        }
        onChange={(unit) => onChange?.(unit)}
      />
    );
  }
);
StorageUnit.displayName = "StorageUnit";

export default StorageUnit;

// ---------------------------------------------------------------------------
// useStorageUnits — kept exported because table cells / non-form callsites
// still pull the flat list (with optional per-item qty hints). The drill
// picker has its own tree fetch; this hook stays as the flat fallback.
// ---------------------------------------------------------------------------

export function useStorageUnits(locationId?: string, itemId?: string) {
  const storageUnitsFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();
  const storageUnitsWithQuantitiesFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (locationId) {
      if (itemId) {
        storageUnitsWithQuantitiesFetcher.load(
          path.to.api.storageUnitsWithQuantities(locationId, itemId)
        );
      }
      storageUnitsFetcher.load(path.to.api.storageUnits(locationId));
    }
  }, [locationId, itemId]);

  const options = useMemo(() => {
    if (itemId && storageUnitsWithQuantitiesFetcher.data?.data) {
      const storageUnitsWithQuantities =
        storageUnitsWithQuantitiesFetcher.data.data;
      const allStorageUnits = storageUnitsFetcher.data?.data ?? [];

      const storageUnitIdsWithQuantities = new Set(
        storageUnitsWithQuantities.map((s: any) => s.id)
      );

      const storageUnitsWithoutQuantities = allStorageUnits.filter(
        (storageUnit: any) => !storageUnitIdsWithQuantities.has(storageUnit.id)
      );

      const combinedStorageUnits = [
        ...storageUnitsWithQuantities.map((c: any) => ({
          value: c.id,
          label: c.name,
          helper: `Qty: ${c.quantity}`
        })),
        ...storageUnitsWithoutQuantities.map((c: any) => ({
          value: c.id,
          label: c.name
        }))
      ];

      return combinedStorageUnits;
    }

    return (
      storageUnitsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
        // Add quantity as helper text if available
        // @ts-expect-error
        ...(c.quantity !== undefined && { helper: `Qty: ${c.quantity}` })
      })) ?? []
    );
  }, [
    storageUnitsFetcher.data,
    storageUnitsWithQuantitiesFetcher.data,
    itemId
  ]);

  return { options, data: storageUnitsFetcher.data };
}
