import { cn } from "@carbon/react";
import type { ReactNode } from "react";

export type FieldEmptyStateProps = {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export const fieldEmptyStateLinkClassName =
  "text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid";

const FieldEmptyState = ({
  title,
  description,
  icon,
  className
}: FieldEmptyStateProps) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-5 px-4 text-center",
        className
      )}
    >
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
        {description}
      </p>
    </div>
  );
};

FieldEmptyState.displayName = "FieldEmptyState";

export default FieldEmptyState;
