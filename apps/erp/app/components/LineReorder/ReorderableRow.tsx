import { cn, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuGripVertical } from "react-icons/lu";
import type { DragHandleBindings } from "./types";

type ReorderableRowProps = {
  dragHandle?: DragHandleBindings;
  isOverlay?: boolean;
  children: ReactNode;
};

/**
 * Visual frame for a reorderable line row. Renders a left-aligned grip
 * handle (bound to dnd-kit listeners) plus a child slot for the entity's
 * own content. When `isOverlay` is true, styles itself for use inside a
 * `<DragOverlay>` (card surface + ring + shadow).
 */
export function ReorderableRow({
  dragHandle,
  isOverlay,
  children
}: ReorderableRowProps) {
  const { t } = useLingui();
  return (
    <HStack
      spacing={0}
      className={cn(
        "w-full items-center relative",
        isOverlay && "bg-card shadow-lg ring-1 ring-primary rounded-sm"
      )}
    >
      {dragHandle && (
        <button
          type="button"
          aria-label={t`Drag to reorder`}
          className="px-2 py-3 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <LuGripVertical className="w-4 h-4" />
        </button>
      )}
      {children}
    </HStack>
  );
}
