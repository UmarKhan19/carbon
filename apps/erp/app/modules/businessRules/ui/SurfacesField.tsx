import { useControlField, useField } from "@carbon/form";
import {
  ChoiceSelect,
  type ChoiceSelectOption,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import {
  SURFACES_BY_TARGET_TYPE,
  TRANSACTION_SURFACES,
  type TransactionSurface
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import {
  LuArrowRightLeft,
  LuPackage,
  LuScale,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";

const SURFACE_META: Record<
  TransactionSurface,
  { title: string; description: string; icon: JSX.Element }
> = {
  receipt: {
    title: "Receipts",
    description: "When goods arrive at a location",
    icon: <LuTruck />
  },
  shipment: {
    title: "Shipments",
    description: "When goods leave a location",
    icon: <LuPackage />
  },
  stockTransfer: {
    title: "Stock transfers",
    description: "When goods move between storage units",
    icon: <LuArrowRightLeft />
  },
  warehouseTransfer: {
    title: "Warehouse transfers",
    description: "When goods move between warehouses",
    icon: <LuWarehouse />
  },
  inventoryAdjustment: {
    title: "Inventory adjustments",
    description: "Manual quantity edits at a storage unit",
    icon: <LuScale />
  },
  putaway: {
    title: "Putaway",
    description: "When stock is placed into a storage unit",
    icon: <LuPackage />
  },
  pick: {
    title: "Pick",
    description: "When stock is taken from a storage unit",
    icon: <LuPackage />
  },
  operationStart: {
    title: "Operation start",
    description: "When an operator starts a job operation",
    icon: <LuArrowRightLeft />
  },
  operationFinish: {
    title: "Operation finish",
    description: "When an operator completes a job operation",
    icon: <LuArrowRightLeft />
  },
  materialIssue: {
    title: "Material issue",
    description: "When material is consumed by an operation",
    icon: <LuScale />
  },
  materialReceive: {
    title: "Material receive",
    description: "When material is returned from an operation",
    icon: <LuScale />
  }
};

type SurfacesFieldProps = {
  name: string;
  label?: string;
  targetType?: "item" | "storageUnit" | "workCenter";
};

/**
 * Multi-select for the rule's `surfaces` field. Uses ChoiceSelect's `multiple`
 * mode — same compact trigger style as the severity picker.
 *
 * Soft-guards against unchecking the last selected surface (zod `min(1)` is
 * the server-side backstop).
 */
export default function SurfacesField({
  name,
  label,
  targetType
}: SurfacesFieldProps) {
  const { t } = useLingui();
  const { error, isOptional } = useField(name);
  const [value, setValue] = useControlField<TransactionSurface[]>(name);
  const selected = value ?? [];

  const allowed = targetType
    ? new Set<TransactionSurface>(SURFACES_BY_TARGET_TYPE[targetType])
    : null;
  const visibleSurfaces = allowed
    ? TRANSACTION_SURFACES.filter((s) => allowed.has(s))
    : TRANSACTION_SURFACES;

  const options: ChoiceSelectOption<TransactionSurface>[] = visibleSurfaces.map(
    (s) => ({
      value: s,
      title: SURFACE_META[s].title,
      description: SURFACE_META[s].description,
      icon: SURFACE_META[s].icon
    })
  );

  const handleChange = (next: TransactionSurface[]) => {
    if (next.length === 0) return; // soft guard — keep at least one
    setValue(next);
  };

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel isOptional={isOptional} htmlFor={name}>
        {label ?? t`Triggers`}
      </FormLabel>

      {selected.map((surface, index) => (
        <input
          key={surface}
          type="hidden"
          name={`${name}[${index}]`}
          value={surface}
        />
      ))}

      <ChoiceSelect<TransactionSurface>
        multiple
        value={selected}
        onChange={handleChange}
        options={options}
        placeholder={t`Select surfaces`}
        aria-label={label ?? t`Applies to`}
      />

      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}
