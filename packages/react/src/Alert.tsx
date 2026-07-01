import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const alertVariants = cva(
  "relative flex flex-col gap-1.5 w-full rounded-lg border p-3 transition-colors [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-[10px] [&>svg]:text-foreground dark:inset-ring dark:inset-ring-white/5",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        success:
          "bg-gradient-fade border-status-green/40 from-status-green/15 text-status-green-fg [&>svg]:text-status-green",
        info: "bg-gradient-fade border-status-blue/40 from-status-blue/15 text-status-blue-fg [&>svg]:text-status-blue",
        warning:
          "bg-gradient-fade border-status-yellow/40 from-status-yellow/15 text-status-yellow-fg [&>svg]:text-status-yellow",
        destructive:
          "bg-gradient-fade border-status-red/40 from-status-red/15 text-status-red-fg [&>svg]:text-status-red"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

const Alert = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("font-medium leading-none text-sm", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
