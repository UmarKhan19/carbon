import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuSquareUser, LuUsers } from "react-icons/lu";

export type ScopeOption = {
  value: string;
  label: string;
  helper: "Type" | "Customer";
};

type ScopePickerProps = {
  value: string;
  options: ScopeOption[];
  onChange: (value: string) => void;
  size?: "sm" | "md";
  placeholder?: string;
};

export function ScopePicker({
  value,
  options,
  onChange,
  size = "sm",
  placeholder
}: ScopePickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const { types, customers, selected } = useMemo(() => {
    const types: ScopeOption[] = [];
    const customers: ScopeOption[] = [];
    let selected: ScopeOption | undefined;
    for (const o of options) {
      if (o.value === value) selected = o;
      (o.helper === "Type" ? types : customers).push(o);
    }
    return { types, customers, selected };
  }, [options, value]);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          asButton
          size={size}
          role="combobox"
          aria-expanded={open}
          className={cn(
            "min-w-[220px] hover:scale-100 focus-visible:scale-100",
            !value && "text-muted-foreground"
          )}
          onClick={() => setOpen(true)}
        >
          {selected ? (
            <span className="!flex items-center gap-2 truncate">
              {selected.helper === "Type" ? (
                <LuUsers className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <LuSquareUser className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="!text-muted-foreground">
              {placeholder ?? t`Select scope`}
            </span>
          )}
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[--radix-popover-trigger-width] w-[280px] p-0"
      >
        <Command>
          <CommandInput
            placeholder={t`Search customers and types...`}
            className="h-9"
          />
          <CommandList className="max-h-[320px]">
            {types.length > 0 && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <LuUsers className="size-3" />
                    {t`Customer Types`}
                  </span>
                }
              >
                {types.map((opt) => (
                  <ScopeItem
                    key={opt.value}
                    option={opt}
                    selected={opt.value === value}
                    onSelect={select}
                  />
                ))}
              </CommandGroup>
            )}

            {types.length > 0 && customers.length > 0 && (
              <CommandSeparator className="my-1" />
            )}

            {customers.length > 0 && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <LuSquareUser className="size-3" />
                    {t`Customers`}
                  </span>
                }
              >
                {customers.map((opt) => (
                  <ScopeItem
                    key={opt.value}
                    option={opt}
                    selected={opt.value === value}
                    onSelect={select}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ScopeItem({
  option,
  selected,
  onSelect
}: {
  option: ScopeOption;
  selected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandItem
      value={`${option.label} ${option.helper} ${option.value}`}
      onSelect={() => onSelect(option.value)}
    >
      <span className="flex-1 truncate">{option.label}</span>
      <LuCheck
        className={cn("ml-2 size-4", selected ? "opacity-100" : "opacity-0")}
      />
    </CommandItem>
  );
}
