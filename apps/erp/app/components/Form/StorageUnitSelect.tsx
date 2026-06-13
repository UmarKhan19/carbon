// Leaf storage-unit picker — the default "pick a particular bin" control.
// Built on the canonical `CreatableCombobox` (like UnitOfMeasure, WorkCenter,
// …) rather than a bespoke popover. The hierarchical drill-down lives in
// `StorageUnitDrillSelect` and is only used by the Parent picker.
//
// Two exports mirror the rest of the form library:
// - `StorageUnitSelect` — form-bound (`name`) via `@carbon/form`.
// - `StorageUnitSelectControl` — controlled (`value`/`onChange`) for table
//   cells and other non-form contexts.

import { CreatableCombobox, type CreatableComboboxProps } from "@carbon/form";
import {
  CreatableCombobox as CreatableComboboxBase,
  useDisclosure
} from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import StorageUnitForm from "~/modules/inventory/ui/StorageUnits/StorageUnitForm";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { useStorageUnitsTree } from "./StorageUnitDrillSelect";

type StorageUnitOption = {
  value: string;
  label: string;
  helper?: string;
};

/**
 * Per-unit on-hand quantities for `itemId`, keyed by storage-unit id. Only
 * fetches when both ids are present, so item-less pickers don't pay for it.
 */
function useStorageUnitQuantities(locationId?: string | null, itemId?: string) {
  const fetcher = useFetcher<{ data: { id: string; quantity: number }[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity changes every render
  useEffect(() => {
    if (locationId && itemId) {
      fetcher.load(path.to.api.storageUnitsWithQuantities(locationId, itemId));
    }
  }, [locationId, itemId]);

  return useMemo(() => {
    const m = new Map<string, number>();
    for (const s of fetcher.data?.data ?? []) m.set(s.id, s.quantity);
    return m;
  }, [fetcher.data]);
}

/**
 * Options for the leaf bins in a location (nodes with no children — the
 * storable locations). `helper` shows the on-hand quantity when `itemId` is
 * given, otherwise the hierarchy path to disambiguate same-named bins.
 */
export function useStorageUnitLeafOptions(
  locationId?: string | null,
  itemId?: string
): StorageUnitOption[] {
  const rows = useStorageUnitsTree(locationId);
  const quantities = useStorageUnitQuantities(locationId, itemId);

  return useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parentIds = new Set(
      rows.map((r) => r.parentId).filter((id): id is string => Boolean(id))
    );

    return rows
      .filter((r) => !parentIds.has(r.id))
      .map((r) => {
        const ancestorPath = (r.ancestorPath ?? [])
          .slice(0, -1)
          .map((id) => byId.get(id)?.name)
          .filter(Boolean)
          .join(" / ");
        return {
          value: r.id,
          label: r.name,
          helper: itemId
            ? `Qty: ${quantities.get(r.id) ?? 0}`
            : ancestorPath || undefined
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, quantities, itemId]);
}

/**
 * Shared "+ New storage unit" flow. `onCreateOption` seeds the form with the
 * typed text; closing the modal re-clicks the trigger so the combobox reopens
 * with the freshly created unit selectable.
 */
function useNewStorageUnitModal(locationId?: string | null) {
  const modal = useDisclosure();
  const [created, setCreated] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const node =
    modal.isOpen && locationId ? (
      <StorageUnitForm
        type="modal"
        locationId={locationId}
        onClose={() => {
          setCreated("");
          modal.onClose();
          triggerRef.current?.click();
        }}
        initialValues={{ name: created, locationId, storageTypeIds: [] }}
      />
    ) : null;

  const onCreateOption = (value: string) => {
    setCreated(value);
    modal.onOpen();
  };

  return { triggerRef, onCreateOption, node };
}

const storageUnitPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const match = options.find((o) => o.value === value);
  return <span className="text-sm">{match?.label ?? ""}</span>;
};

const labelToString = (label: string | JSX.Element) =>
  typeof label === "string" ? label : "";

// ---------------------------------------------------------------------------
// Form-bound variant
// ---------------------------------------------------------------------------

type StorageUnitSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string | null;
  itemId?: string;
  /** Render a compact inline preview (for table cells) once a value is set. */
  inline?: boolean;
  onChange?: (storageUnit: ListItem | null) => void;
};

export function StorageUnitSelect({
  locationId,
  itemId,
  inline,
  label,
  placeholder,
  onChange,
  ...props
}: StorageUnitSelectProps) {
  const options = useStorageUnitLeafOptions(locationId, itemId);
  const { triggerRef, onCreateOption, node } =
    useNewStorageUnitModal(locationId);

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={label ?? "Storage Unit"}
        placeholder={placeholder ?? "Select storage unit"}
        inline={inline ? storageUnitPreview : undefined}
        onCreateOption={onCreateOption}
        onChange={(option) =>
          onChange?.(
            option
              ? { id: option.value, name: labelToString(option.label) }
              : null
          )
        }
      />
      {node}
    </>
  );
}

// ---------------------------------------------------------------------------
// Controlled variant
// ---------------------------------------------------------------------------

type StorageUnitSelectControlProps = {
  locationId?: string | null;
  value?: string | null;
  itemId?: string;
  isReadOnly?: boolean;
  placeholder?: string;
  className?: string;
  /** Show the "+ New storage unit" create option. Defaults to `true`. */
  allowCreate?: boolean;
  onChange: (storageUnit: ListItem | null) => void;
};

export function StorageUnitSelectControl({
  locationId,
  value,
  itemId,
  isReadOnly,
  placeholder,
  className,
  allowCreate = true,
  onChange
}: StorageUnitSelectControlProps) {
  const options = useStorageUnitLeafOptions(locationId, itemId);
  const { triggerRef, onCreateOption, node } =
    useNewStorageUnitModal(locationId);

  if (!locationId) return null;

  return (
    <>
      <CreatableComboboxBase
        ref={triggerRef}
        options={options}
        value={value ?? undefined}
        isReadOnly={isReadOnly}
        isClearable
        placeholder={placeholder ?? "Select storage unit"}
        className={className}
        onCreateOption={allowCreate ? onCreateOption : undefined}
        onChange={(selected) =>
          onChange(
            selected
              ? {
                  id: selected,
                  name: labelToString(
                    options.find((o) => o.value === selected)?.label ?? ""
                  )
                }
              : null
          )
        }
      />
      {node}
    </>
  );
}
