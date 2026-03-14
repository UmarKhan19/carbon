import {
  cn,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import type { DateRange } from "@react-types/datepicker";
import { motion } from "framer-motion";
import { Fragment, useId, useMemo } from "react";
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
  itemWidth?: string;
  className?: string;
}

const defaultOptions: DateSelectOption[] = [
  { value: "week", label: "7D" },
  { value: "month", label: "30D" },
  { value: "quarter", label: "90D" },
  { value: "year", label: "1Y" }
];

export function DateSelect({
  value,
  onValueChange,
  options = defaultOptions,
  showCustom = true,
  dateRange,
  onDateRangeChange,
  itemWidth,
  className
}: DateSelectProps) {
  const layoutId = useId();

  const allOptions = useMemo(() => {
    if (!showCustom) return options;
    return [...options, { value: "custom", label: "Custom" }];
  }, [options, showCustom]);

  const computedWidth = useMemo(() => {
    if (itemWidth) return itemWidth;
    const longest = Math.max(...options.map((o) => o.label.length));
    return `${longest + 2.5}ch`;
  }, [options, itemWidth]);

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
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

      {/* Pill segmented control for md+ screens */}
      <div className="date-select hidden md:inline-flex items-center bg-muted">
        {options.map((option, index) => (
          <Fragment key={option.value}>
            {index > 0 && <span className="date-select-separator" />}
            <button
              type="button"
              onClick={() => onValueChange(option.value)}
              className={cn(
                "date-select-item relative py-1.5 text-sm font-medium text-center",
                "text-muted-foreground transition-colors",
                value === option.value
                  ? "text-foreground"
                  : "hover:text-foreground hover:bg-background/50"
              )}
              style={{
                width: computedWidth,
                WebkitTapHighlightColor: "transparent"
              }}
            >
              {value === option.value && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 z-10 date-select-active bg-background"
                  transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                />
              )}
              <span className="relative z-20">{option.label}</span>
            </button>
          </Fragment>
        ))}
        {showCustom && (
          <>
            <span className="date-select-separator" />
            <button
              type="button"
              onClick={() => onValueChange("custom")}
              className={cn(
                "date-select-item relative aspect-square text-sm text-center",
                "text-muted-foreground transition-colors",
                "flex items-center justify-center",
                value === "custom"
                  ? "text-foreground"
                  : "hover:text-foreground hover:bg-background/50"
              )}
              style={{
                width: "2rem",
                height: "2rem",
                WebkitTapHighlightColor: "transparent"
              }}
            >
              {value === "custom" && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 z-10 date-select-active bg-background"
                  transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                />
              )}
              <LuCalendar className="relative z-20 size-3.5" />
            </button>
          </>
        )}
      </div>
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
