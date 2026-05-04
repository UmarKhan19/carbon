import { Input, MultiSelect } from "@carbon/react";
import type { FieldDef, Operator } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { memo } from "react";
import type { ValueOption } from "./useValueOptions";
import ValueCombobox from "./ValueCombobox";

type ValueInputProps = {
  fieldDef: FieldDef | undefined;
  op: Operator;
  value: unknown;
  onChange: (next: unknown) => void;
  options: ValueOption[] | undefined;
};

const isMultiOp = (op: Operator) => op === "in" || op === "notIn";
const isPresenceOp = (op: Operator) => op === "isSet" || op === "isNotSet";

function ValueInputImpl({
  fieldDef,
  op,
  value,
  onChange,
  options
}: ValueInputProps) {
  const { t } = useLingui();

  // Presence ops — no value control. Render dashed placeholder pill so the
  // grid column stays the same width (matches existing visual treatment).
  // Height matches CommandTrigger size="md" (h-10) so the row stays aligned.
  if (isPresenceOp(op)) {
    return (
      <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
        {t`No value needed`}
      </div>
    );
  }

  // Render the autocomplete combobox whenever the field declares a loader,
  // even if `options` is currently empty. The fetcher hooks populate
  // asynchronously on mount; an empty array still renders a usable Combobox
  // (showing the "no values" empty state) which then re-renders with options
  // when the fetch resolves. Falling through to a text input on empty was the
  // bug — the input got "stuck" until the user re-selected the field.
  const hasOptions = !!fieldDef?.valueOptionsLoader && !!options;
  const multi = isMultiOp(op);

  // Multi-select with a known options loader — supplies a real string[] array
  // straight to the AST (no comma-split parsing needed).
  if (multi && hasOptions) {
    const arrValue = Array.isArray(value)
      ? value.map(String).filter(Boolean)
      : [];
    return (
      <MultiSelect
        size="md"
        className="w-full"
        value={arrValue}
        onChange={(next) => onChange(next)}
        options={options!}
        placeholder={t`Select values`}
      />
    );
  }

  // Single-select autocomplete — used for any scalar op on a field with a
  // loader. Local component for visual parity with FieldCombobox /
  // OperatorCombobox (chevron trigger, same height, full-width).
  if (!multi && hasOptions) {
    const strValue =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    return (
      <ValueCombobox
        value={strValue}
        onChange={(next) => onChange(next)}
        options={options!}
        placeholder={t`Select value`}
      />
    );
  }

  // Numeric input — only valid on scalar ops; multi on a numeric field falls
  // through to the comma-separated text path below.
  if (!multi && fieldDef?.type === "number") {
    const numValue =
      typeof value === "number"
        ? String(value)
        : typeof value === "string"
          ? value
          : "";
    return (
      <Input
        size="md"
        type="number"
        placeholder={t`Number`}
        value={numValue}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw === "" || Number.isNaN(n) ? undefined : n);
        }}
      />
    );
  }

  // Fallback — string input. Multi-value without a loader stays as
  // comma-separated text so users can still type literal sets (e.g. on custom
  // fields where no option list is known).
  const display =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);

  return (
    <Input
      size="md"
      type="text"
      placeholder={multi ? t`comma-separated values` : t`Value`}
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (multi) {
          onChange(
            raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          );
        } else {
          onChange(raw);
        }
      }}
    />
  );
}

export default memo(ValueInputImpl);
