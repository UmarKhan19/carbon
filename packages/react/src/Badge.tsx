import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes
} from "react";
import { forwardRef } from "react";

import { LuX } from "react-icons/lu";
import { cn } from "./utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 min-h-[1.25rem] font-medium transition-[color,box-shadow] border focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 font-bold text-[11px] uppercase truncate tracking-tight whitespace-nowrap",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow:sm dark:shadow hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "bg-destructive text-destructive-foreground shadow:sm dark:shadow hover:bg-destructive/80",
        outline: "text-foreground border border-border",
        green:
          "bg-status-green/12 text-status-green-fg border-status-green/25 hover:bg-status-green/20",
        yellow:
          "bg-status-yellow/12 text-status-yellow-fg border-status-yellow/25 hover:bg-status-yellow/20",
        orange:
          "bg-status-orange/12 text-status-orange-fg border-status-orange/25 hover:bg-status-orange/20",
        red: "bg-status-red/12 text-status-red-fg border-status-red/25 hover:bg-status-red/20",
        blue: "bg-status-blue/12 text-status-blue-fg border-status-blue/25 hover:bg-status-blue/20",
        gray: "bg-status-gray/15 text-status-gray-fg border-status-gray/25 hover:bg-status-gray/25",
        purple:
          "bg-status-purple/12 text-status-purple-fg border-status-purple/25 hover:bg-status-purple/20"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant }), "min-w-0", className)}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

const BadgeCloseButton = forwardRef<
  ElementRef<"button">,
  ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    className={cn(
      "relative ml-1 rounded-full outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground flex-shrink-0 before:absolute before:-inset-2 before:content-['']",
      className
    )}
    {...props}
  >
    <LuX className="h-3 w-3" />
  </button>
));
BadgeCloseButton.displayName = "BadgeCloseButton";
export { Badge, BadgeCloseButton, badgeVariants };
