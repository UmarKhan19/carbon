import { IconButton, Input, cn } from "@carbon/react";
import {
  type Condition,
  type FieldDef,
  getFieldDef,
  type Operator
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { LuX } from "react-icons/lu";
import FieldCombobox from "./FieldCombobox";
import OperatorCombobox from "./OperatorCombobox";

export const CONDITION_GRID_CLASS =
  "grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]";

type ConditionRowProps = {
  condition: Condition;
  index: number;
  canRemove: boolean;
  onChange: (index: number, patch: Partial<Condition>) => void;
  onRemove: (index: number) => void;
};

function ConditionRowImpl({
  condition,
  index,
  canRemove,
  onChange,
  onRemove
}: ConditionRowProps) {
  const { t } = useLingui();

  const fieldDef = useMemo<FieldDef | undefined>(
    () => getFieldDef(condition.field),
    [condition.field]
  );

  const needsValue = condition.op !== "isSet" && condition.op !== "isNotSet";
  const isMultiValue = condition.op === "in" || condition.op === "notIn";
  const valueDisplay = useMemo(() => {
    if (condition.value == null) return "";
    if (Array.isArray(condition.value)) return condition.value.join(", ");
    return String(condition.value);
  }, [condition.value]);

  return (
    <div
      className={cn(
        "group relative w-full rounded-lg border border-border bg-card p-3",
        "transition-colors hover:border-border/80"
      )}
    >
      <div className={CONDITION_GRID_CLASS}>
        <FieldCombobox
          value={condition.field}
          onChange={(path) => onChange(index, { field: path, op: "eq" })}
        />

        <OperatorCombobox
          value={condition.op}
          onChange={(op) => onChange(index, { op, value: undefined })}
          available={fieldDef?.operators ?? []}
          disabled={!fieldDef}
        />

        {needsValue ? (
          <Input
            size="sm"
            type={fieldDef?.type === "number" && !isMultiValue ? "number" : "text"}
            placeholder={
              isMultiValue
                ? t`comma-separated values`
                : fieldDef?.type === "number"
                  ? t`Number`
                  : t`Value`
            }
            value={valueDisplay}
            onChange={(e) => {
              const raw = e.target.value;
              if (isMultiValue) {
                onChange(index, {
                  value: raw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                });
              } else if (fieldDef?.type === "number") {
                const n = Number(raw);
                onChange(index, {
                  value: raw === "" || Number.isNaN(n) ? undefined : n
                });
              } else {
                onChange(index, { value: raw });
              }
            }}
          />
        ) : (
          <div className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
            {t`No value needed`}
          </div>
        )}
      </div>

      <IconButton
        icon={<LuX />}
        aria-label={t`Remove condition`}
        variant="ghost"
        size="sm"
        onClick={() => onRemove(index)}
        isDisabled={!canRemove}
        className={cn(
          "absolute right-1.5 top-1.5",
          !canRemove && "opacity-0 pointer-events-none"
        )}
      />
    </div>
  );
}

export default memo(ConditionRowImpl);
