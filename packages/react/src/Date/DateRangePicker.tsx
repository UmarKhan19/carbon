import { useDateRangePicker } from "@react-aria/datepicker";
import { useDateRangePickerState } from "@react-stately/datepicker";
import type { DateRangePickerProps, DateValue } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import { useRef } from "react";
import { LuBan, LuCalendar } from "react-icons/lu";
import { HStack } from "../HStack";
import { IconButton } from "../IconButton";
import { InputGroup } from "../Input";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
import DateField from "./components/DateField";
import { RangeCalendar } from "./components/RangeCalendar";

const iconVariants = cva("", {
  variants: {
    size: {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-5 w-5"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const fieldVariants = cva("flex w-full", {
  variants: {
    size: {
      sm: "px-2 py-1",
      md: "px-4 py-2",
      lg: "px-6 py-3"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const DateRangePicker = ({
  size = "md",
  ...props
}: DateRangePickerProps<DateValue> & {
  size?: "sm" | "md" | "lg";
}) => {
  const state = useDateRangePickerState({
    ...props,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  // Base UI's PopoverTrigger owns opening via the controlled state; react-aria's
  // `buttonProps` toggle is intentionally unused (both on one button = double-toggle).
  const {
    groupProps,
    startFieldProps,
    endFieldProps,
    dialogProps,
    calendarProps
  } = useDateRangePicker(props, state, ref);

  return (
    <Popover open={state.isOpen} onOpenChange={state.setOpen}>
      <div className="relative inline-flex flex-col w-full">
        <HStack className="w-full" spacing={0}>
          <InputGroup
            {...groupProps}
            ref={ref}
            size={size}
            className="w-full inline-flex rounded-r-none"
          >
            <div className={fieldVariants({ size })}>
              <DateField {...startFieldProps} size={size} />
              <span aria-hidden="true" className="px-2">
                –
              </span>
              <DateField {...endFieldProps} size={size} />
              {state.isInvalid && (
                <LuBan
                  className={`text-destructive-foreground absolute right-[12px] ${iconVariants(
                    { size }
                  )}`}
                />
              )}
            </div>
          </InputGroup>

          <PopoverTrigger asChild>
            <IconButton
              aria-label="Toggle"
              icon={<LuCalendar />}
              variant="secondary"
              size={size}
              isDisabled={props.isDisabled}
              className="flex-shrink-0 rounded-l-none border border-l-0 before:rounded-l-none"
            />
          </PopoverTrigger>
        </HStack>
        <PopoverContent align="end" {...dialogProps}>
          <RangeCalendar {...calendarProps} />
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DateRangePicker;
