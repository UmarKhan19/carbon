import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./utils/cn";

const pulseVariants = cva("", {
  variants: {
    variant: {
      amber: "text-status-yellow",
      green: "text-status-green",
      yellow: "text-status-yellow",
      orange: "text-status-orange",
      red: "text-status-red",
      blue: "text-status-blue",
      gray: "text-status-gray",
      purple: "text-status-purple"
    }
  },
  defaultVariants: {
    variant: "green"
  }
});

type PulseVariants = VariantProps<typeof pulseVariants>;

export function PulsingDot({
  inactive,
  variant,
  className,
  ...props
}: ComponentProps<"span"> & { inactive?: boolean } & PulseVariants) {
  if (inactive) {
    return (
      <span
        className={cn(
          "w-2 h-2 rounded-full bg-current",
          pulseVariants({ variant }),
          className
        )}
        {...props}
      />
    );
  }

  return (
    <span
      className={cn(
        "relative flex h-2 w-2",
        pulseVariants({ variant }),
        className
      )}
      {...props}
    >
      <span className="absolute h-full w-full animate-ping rounded-full border border-current opacity-100 duration-1000" />
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
