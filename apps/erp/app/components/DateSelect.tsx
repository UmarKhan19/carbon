import {
  cn,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import type { DateRange } from "@react-types/datepicker";
import { forwardRef, useMemo } from "react";
import { LuCalendar } from "react-icons/lu";

type DateSelectOption = {
  value: string;
  label: string;
};

interface DateSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options?: DateSelectOption[];
  showCustom?: boolean;
  dateRange?: DateRange | null;
  onDateRangeChange?: (dateRange: DateRange | null) => void;
  className?: string;
}

const defaultOptions: DateSelectOption[] = [
  { value: "week", label: "7D" },
  { value: "month", label: "30D" },
  { value: "quarter", label: "90D" },
  { value: "year", label: "1Y" }
];

const DateSelect = forwardRef<HTMLDivElement, DateSelectProps>(
  (
    {
      value,
      onValueChange,
      options = defaultOptions,
      showCustom = true,
      dateRange,
      onDateRangeChange,
      className
    },
    ref
  ) => {
    const allOptions = useMemo(() => {
      if (!showCustom) return options;
      return [...options, { value: "custom", label: "Custom" }];
    }, [options, showCustom]);

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-2", className)}
      >
        {/* Compact dropdown for small screens */}
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="md:hidden w-auto h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Segmented control for md+ screens */}
        <ToggleGroup
          type="single"
          value={value}
          onValueChange={(v) => {
            if (v) onValueChange(v);
          }}
          className="hidden md:inline-flex gap-0 rounded-full border border-border bg-muted p-0.5 shadow-sm"
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium",
                "bg-transparent text-muted-foreground",
                "hover:bg-active hover:text-active-foreground hover:data-[state=on]:bg-active",
                "data-[state=on]:bg-active data-[state=on]:text-active-foreground data-[state=on]:shadow-sm",
                "transition-all duration-200"
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
          {showCustom && (
            <ToggleGroupItem
              value="custom"
              className={cn(
                "h-7 w-7 rounded-full p-0",
                "bg-transparent text-muted-foreground",
                "hover:bg-active hover:text-active-foreground",
                "data-[state=on]:bg-active data-[state=on]:text-active-foreground data-[state=on]:shadow-sm",
                "transition-all duration-200"
              )}
            >
              <LuCalendar className="size-3.5" />
            </ToggleGroupItem>
          )}
        </ToggleGroup>

        {value === "custom" && onDateRangeChange && (
          <DateRangePicker
            value={dateRange}
            onChange={onDateRangeChange}
            size="sm"
          />
        )}
      </div>
    );
  }
);

DateSelect.displayName = "DateSelect";

export { DateSelect };
export type { DateSelectProps, DateSelectOption };
