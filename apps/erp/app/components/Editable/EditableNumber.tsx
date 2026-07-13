import type { NumberFieldProps } from "@carbon/react";
import { NumberField, NumberInput } from "@carbon/react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { EditableTableCellComponentProps } from "~/components/Editable";

// The active app locale, hook-free (the editable cell is a nested render fn, not
// a hook context). `root.tsx` stamps it on <html lang>; fall back to the browser
// locale, then "en".
function getActiveLocale(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

// Parse a user-typed number string in the active locale. We must read the DOM
// text on blur (react-aria's own onChange is lost when moving to another cell
// unmounts the input mid-commit — see the NumberField note below), but we must
// NOT assume `.`/`,` roles: derive the locale's group + decimal separators from
// Intl so "1.234,5" (de) and "1,234.5" (en) both parse correctly. Returns NaN
// for empty/unparseable input so the caller treats it as "no value" rather than
// silently persisting 0.
function parseLocaleNumber(text: string, locale: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return NaN;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const normalized = trimmed
    .split(group)
    .join("") // drop grouping separators
    .replace(decimal, ".") // localize the decimal separator
    .replace(/[^0-9.-]/g, ""); // strip currency, spaces, RTL marks, etc.
  if (normalized === "" || normalized === "-" || normalized === ".") return NaN;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const EditableNumber =
  <T extends object>(
    mutation: (
      accessorKey: string,
      newValue: string,
      row: T
    ) => Promise<PostgrestSingleResponse<unknown>>,
    // Static props, or a function of the row for per-row limits (e.g. a serial
    // line's `maxValue: 1`).
    numberFieldProps?: NumberFieldProps | ((row: T) => NumberFieldProps),
    // `clearable` lets an empty input persist as a cleared value (sent as "") so
    // a nullable column can be reset. Off by default so non-nullable columns keep
    // ignoring empty input.
    options?: { clearable?: boolean }
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate
  }: EditableTableCellComponentProps<T>) => {
    const resolvedProps =
      typeof numberFieldProps === "function"
        ? numberFieldProps(row)
        : numberFieldProps;

    // Postgres NUMERIC columns arrive as strings over the wire — coerce for the
    // NumberField's initial (uncontrolled) value.
    const numericValue =
      value === null || value === undefined || value === ""
        ? undefined
        : Number(value);

    const clamp = (n: number) => {
      const { minValue, maxValue } = resolvedProps ?? {};
      let v = n;
      if (typeof maxValue === "number") v = Math.min(v, maxValue);
      if (typeof minValue === "number") v = Math.max(v, minValue);
      return v;
    };

    // Push an edit into the table's state model + persist it.
    const commit = (raw: number | undefined) => {
      const isEmpty = raw === undefined || !Number.isFinite(raw);
      const next = isEmpty ? null : clamp(raw as number);
      // Nothing changed (or an ignorable empty on a non-clearable/empty cell).
      if (next === (numericValue ?? null)) return;
      if (
        isEmpty &&
        (!options?.clearable || value === null || value === undefined)
      )
        return;

      onUpdate({ [accessorKey]: next });

      // @ts-ignore - mutation receives the raw cell value ("" clears)
      mutation(accessorKey, isEmpty ? "" : next, row)
        .then(({ error }) => {
          if (error) {
            onError();
            onUpdate({ [accessorKey]: value });
          }
        })
        .catch(() => {
          onError();
          onUpdate({ [accessorKey]: value });
        });
    };

    return (
      // UNCONTROLLED (`defaultValue`, not `value`): the editing input only mounts
      // for the selected cell and the surrounding page re-renders often, which
      // would reset a controlled value mid-edit. react-aria's `onChange` commits
      // on blur/Enter — but moving to another cell UNMOUNTS this input, and the
      // unmount races that commit so it never fires. The DOM `onBlur` on the raw
      // input fires synchronously before the unmount, so it is the reliable path
      // that syncs the edit into the table's state model.
      <NumberField {...resolvedProps} defaultValue={numericValue}>
        <NumberInput
          size="sm"
          className="w-full rounded-none outline-none border-none shadow-none focus-visible:ring-0"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const parsed = parseLocaleNumber(
              e.currentTarget.value ?? "",
              getActiveLocale()
            );
            // NaN → treat as empty/no-value (commit guards against persisting 0).
            commit(Number.isNaN(parsed) ? undefined : parsed);
          }}
        />
      </NumberField>
    );
  };

export default EditableNumber;
