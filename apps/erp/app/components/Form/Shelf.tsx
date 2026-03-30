import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getShelvesList } from "~/modules/inventory";
import ShelfForm from "~/modules/inventory/ui/Shelves/ShelfForm";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ShelfSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string;
  itemId?: string;
  inline?: boolean;
  onChange?: (shelf: ListItem | null) => void;
};

const ShelfPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const shelf = options.find((o) => o.value === value);
  if (!shelf) return "Inventory";
  return shelf.label;
};

const Shelf = (props: ShelfSelectProps) => {
  const newShelfModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, data } = useShelves(props.locationId, props.itemId);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const shelf =
      data?.data?.find((shelf) => shelf.id === newValue?.value) ?? null;
    props.onChange?.(shelf as ListItem | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Shelf"}
        inline={props.inline ? ShelfPreview : undefined}
        onChange={onChange}
        onCreateOption={(option) => {
          newShelfModal.onOpen();
          setCreated(option);
        }}
      />

      {newShelfModal.isOpen && (
        <ShelfForm
          locationId={props.locationId!}
          type="modal"
          onClose={() => {
            setCreated("");
            newShelfModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: created, locationId: props?.locationId ?? "" }}
        />
      )}
    </>
  );
};

export default Shelf;

export function useShelves(locationId?: string, itemId?: string) {
  const shelvesFetcher =
    useFetcher<Awaited<ReturnType<typeof getShelvesList>>>();
  const shelvesWithQuantitiesFetcher =
    useFetcher<Awaited<ReturnType<typeof getShelvesList>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (locationId) {
      if (itemId) {
        // Load both shelves with quantities and all shelves
        shelvesWithQuantitiesFetcher.load(
          path.to.api.shelvesWithQuantities(locationId, itemId)
        );
      }
      shelvesFetcher.load(path.to.api.shelves(locationId));
    }
  }, [locationId, itemId]);

  const options = useMemo(() => {
    if (itemId && shelvesWithQuantitiesFetcher.data?.data) {
      // Create a map of shelves with quantities
      const shelvesWithQuantities = shelvesWithQuantitiesFetcher.data.data;
      const allShelves = shelvesFetcher.data?.data ?? [];

      // Create a set of shelf IDs that have quantities
      const shelfIdsWithQuantities = new Set(
        shelvesWithQuantities.map((s: any) => s.id)
      );

      // Filter out shelves that already have quantities from the all shelves list
      const shelvesWithoutQuantities = allShelves.filter(
        (shelf: any) => !shelfIdsWithQuantities.has(shelf.id)
      );

      // Combine the lists: shelves with quantities first, then others
      const combinedShelves = [
        ...shelvesWithQuantities.map((c: any) => ({
          value: c.id,
          label: c.name,
          helper: `Qty: ${c.quantity}`
        })),
        ...shelvesWithoutQuantities.map((c: any) => ({
          value: c.id,
          label: c.name
        }))
      ];

      return combinedShelves;
    }

    // Fallback to original behavior
    return (
      shelvesFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
        // Add quantity as helper text if available
        // @ts-expect-error
        ...(c.quantity !== undefined && { helper: `Qty: ${c.quantity}` })
      })) ?? []
    );
  }, [shelvesFetcher.data, shelvesWithQuantitiesFetcher.data, itemId]);

  return { options, data: shelvesFetcher.data };
}
