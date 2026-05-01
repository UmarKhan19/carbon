"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./Select";

/**
 * Hybrid of {@link ChoiceCardGroup} and {@link Select}: a compact dropdown
 * trigger paired with a rich popover where each option carries an icon,
 * title, and description — the same shape as a ChoiceCard, just rendered
 * inside a Radix Select instead of inline cards.
 *
 * Use this when:
 *   - You want the visual richness of ChoiceCardGroup (icon + description
 *     per option) but don't want to spend the vertical space on inline
 *     cards. ChoiceSelect collapses to a single-line trigger.
 *   - The chosen option is more meaningful than a one-word label, so a
 *     plain `<Select>` wouldn't communicate enough.
 *
 * Closed state: trigger shows the icon + title of the selected option.
 * Open state: each option renders its title with an icon glyph and a
 * muted description line — readers get the full trade-off without
 * having to commit to a card grid in the parent layout.
 *
 * Pure controlled component — callers own the value via `value` /
 * `onChange`. Generic over `V extends string` so a tighter union flows
 * through to the change handler. Pair with `useControlField` + a hidden
 * input when binding to a `ValidatedForm`.
 */
export type ChoiceSelectOption<V extends string = string> = {
  value: V;
  /** Bold label rendered in the trigger and in the dropdown row. */
  title: string;
  /** Optional muted helper line shown only inside the dropdown. */
  description?: string;
  /** Optional left-aligned glyph. Shown in trigger and in the dropdown. */
  icon?: ReactNode;
  /** Greys the option out and blocks selection. */
  disabled?: boolean;
};

type ChoiceSelectProps<V extends string = string> = {
  /** Currently selected value. */
  value: V;
  /** Called with the new value when the user picks a different option. */
  onChange: (value: V) => void;
  /** Choices to render. */
  options: ChoiceSelectOption<V>[];
  /** Optional placeholder when value is empty. */
  placeholder?: string;
  /** Disables the trigger entirely. */
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
  /** Optional aria-label for the trigger. */
  "aria-label"?: string;
};

export function ChoiceSelect<V extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel
}: ChoiceSelectProps<V>) {
  const selected = options.find((o) => o.value === value);

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as V)}
      disabled={disabled}
    >
      {/* The trigger renders a div (not a span) so SelectTrigger's
          `[&>span]:line-clamp-1` rule doesn't kick in and turn the inline
          icon+title row into a block. */}
      <SelectTrigger className={className} aria-label={ariaLabel}>
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
            {selected.icon && (
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted-foreground">
                {selected.icon}
              </span>
            )}
            <span className="text-sm font-medium truncate">
              {selected.title}
            </span>
          </div>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
        {options.map((opt) => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            className="py-2 pr-8"
          >
            <span className="flex items-start gap-3">
              {opt.icon && (
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground mt-0.5">
                  {opt.icon}
                </span>
              )}
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium">{opt.title}</span>
                {opt.description && (
                  <span className="text-xs text-muted-foreground leading-snug">
                    {opt.description}
                  </span>
                )}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
