import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import type { ValueOption } from "./useValueOptions";

type ValueComboboxProps = {
  value: string;
  onChange: (next: string) => void;
  options: ValueOption[];
  placeholder?: string;
  className?: string;
};

/**
 * Single-select autocomplete for a rule condition value. Visually mirrors
 * `FieldCombobox` and `OperatorCombobox` (chevron trigger, Command-driven
 * popover).
 *
 * Filtering is handled manually (`shouldFilter={false}`) instead of via cmdk
 * to avoid the empty-state flash that occurred when async-loaded options
 * arrived mid-render. cmdk re-evaluates its internal filter every time the
 * options array changes; with the auto-filter off, item visibility is driven
 * purely by the local `search` state which is stable across data updates.
 */
export default function ValueCombobox({
  value,
  onChange,
  options,
  placeholder,
  className
}: ValueComboboxProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          size="md"
          role="combobox"
          aria-expanded={open}
          icon={<LuChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
          className={cn(
            "w-full",
            !selected && "text-muted-foreground",
            className
          )}
          onClick={() => setOpen(true)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <div className="truncate">
              {selected?.label ?? placeholder ?? t`Select value`}
            </div>
          </div>
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t`Search...`}
            className="h-10"
          />
          <CommandList
            className="max-h-[280px] overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {options.length === 0 ? t`No values available` : t`No matches`}
              </div>
            ) : (
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value);
                      setSearch("");
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 px-2 py-2"
                  >
                    <span className="flex min-w-0 flex-1 truncate text-sm">
                      {opt.label}
                    </span>
                    <LuCheck
                      className={cn(
                        "h-4 w-4 shrink-0",
                        value === opt.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
