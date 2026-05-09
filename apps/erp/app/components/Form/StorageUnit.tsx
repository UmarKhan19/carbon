import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getStorageUnitsList } from "~/modules/inventory";
import StorageUnitForm from "~/modules/inventory/ui/StorageUnits/StorageUnitForm";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type StorageUnitSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string;
  itemId?: string;
  inline?: boolean;
  onChange?: (storageUnit: ListItem | null) => void;
  /**
   * When set, the option list excludes the given storage unit and every one
   * of its descendants. Used by StorageUnitForm's Parent select so a user
   * cannot pick themselves or a child as the parent (which would create a
   * cycle). The DB enforces the same invariant via
   * storage_unit_enforce_no_cycle; this just keeps the UI honest.
   */
  excludeDescendantsOf?: string;
};

const StorageUnitPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const storageUnit = options.find((o) => o.value === value);
  if (!storageUnit) return "Inventory";
  return storageUnit.label;
};

const StorageUnit = (props: StorageUnitSelectProps) => {
  const newStorageUnitModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options: rawOptions, data } = useStorageUnits(
    props.locationId,
    props.itemId
  );

  const excludedIds = useExcludedDescendantIds(props.excludeDescendantsOf);

  const options = useMemo(() => {
    if (excludedIds.size === 0) return rawOptions;
    return rawOptions.filter((option) => !excludedIds.has(option.value));
  }, [rawOptions, excludedIds]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const storageUnit =
      data?.data?.find((s) => s.id === newValue?.value) ?? null;
    props.onChange?.(storageUnit as ListItem | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Storage Unit"}
        inline={props.inline ? StorageUnitPreview : undefined}
        onChange={onChange}
        onCreateOption={(option) => {
          newStorageUnitModal.onOpen();
          setCreated(option);
        }}
      />

      {newStorageUnitModal.isOpen && (
        <StorageUnitForm
          locationId={props.locationId!}
          type="modal"
          onClose={() => {
            setCreated("");
            newStorageUnitModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            locationId: props?.locationId ?? "",
            storageTypeIds: []
          }}
        />
      )}
    </>
  );
};

export default StorageUnit;

export function useStorageUnits(locationId?: string, itemId?: string) {
  const storageUnitsFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();
  const storageUnitsWithQuantitiesFetcher =
    useFetcher<Awaited<ReturnType<typeof getStorageUnitsList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (locationId) {
      if (itemId) {
        // Load both storage units with quantities and all storage units
        storageUnitsWithQuantitiesFetcher.load(
          path.to.api.storageUnitsWithQuantities(locationId, itemId)
        );
      }
      storageUnitsFetcher.load(path.to.api.storageUnits(locationId));
    }
  }, [locationId, itemId]);

  const options = useMemo(() => {
    if (itemId && storageUnitsWithQuantitiesFetcher.data?.data) {
      // Create a map of storage units with quantities
      const storageUnitsWithQuantities =
        storageUnitsWithQuantitiesFetcher.data.data;
      const allStorageUnits = storageUnitsFetcher.data?.data ?? [];

      // Create a set of storage unit IDs that have quantities
      const storageUnitIdsWithQuantities = new Set(
        storageUnitsWithQuantities.map((s: any) => s.id)
      );

      // Filter out storage units that already have quantities from the all list
      const storageUnitsWithoutQuantities = allStorageUnits.filter(
        (storageUnit: any) => !storageUnitIdsWithQuantities.has(storageUnit.id)
      );

      // Combine the lists: storage units with quantities first, then others
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

    // Fallback to original behavior
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

/**
 * Fetches the set of storage-unit ids in the subtree rooted at `rootId`
 * (rootId itself + all descendants). Returns an empty Set when rootId is
 * undefined so the caller can always do `excludedIds.has(x)` safely.
 */
function useExcludedDescendantIds(rootId?: string): Set<string> {
  const descendantsFetcher = useFetcher<{ data: { id: string }[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (rootId) {
      descendantsFetcher.load(path.to.api.storageUnitDescendants(rootId));
    }
  }, [rootId]);

  return useMemo(() => {
    if (!rootId) return new Set<string>();
    const ids = new Set<string>([rootId]);
    for (const row of descendantsFetcher.data?.data ?? []) {
      if (row.id) ids.add(row.id);
    }
    return ids;
  }, [rootId, descendantsFetcher.data]);
}
