import { Button, cn } from "@carbon/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

type FieldEmptyStateAction =
  | { kind: "link"; to: string; label: ReactNode }
  | { kind: "button"; onClick: () => void; label: ReactNode };

export type FieldEmptyStateProps = {
  title: ReactNode;
  description: ReactNode;
  action?: FieldEmptyStateAction;
  icon?: ReactNode;
  className?: string;
};

const linkClassName =
  "text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid";

const FieldEmptyState = ({
  title,
  description,
  action,
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
      {action?.kind === "link" && (
        <Link to={action.to} className={cn(linkClassName, "mt-2 text-xs")}>
          {action.label}
        </Link>
      )}
      {action?.kind === "button" && (
        <Button
          variant="primary"
          size="sm"
          className="mt-2"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
};

FieldEmptyState.displayName = "FieldEmptyState";

export default FieldEmptyState;
