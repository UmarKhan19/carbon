import { ClientOnly, cn, VStack } from "@carbon/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DragHandleBindings, ReorderableLine } from "./types";

type ReorderableLineListProps<T extends ReorderableLine> = {
  lines: T[];
  activeLine: T | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /**
   * Render the row content (drag-handle + entity-specific body). Receives
   * the drag-handle bindings so the entity can place the grip wherever its
   * layout requires.
   */
  renderRow: (line: T, dragHandle: DragHandleBindings) => ReactNode;
  /** Render the floating ghost shown under the cursor during a drag. */
  renderOverlay: (line: T) => ReactNode;
};

/**
 * dnd-kit wrapper that turns a flat list of `{ id }` objects into a
 * vertical sortable list with a portaled drag overlay. Entity-specific
 * rendering lives in the `renderRow` / `renderOverlay` callbacks.
 */
export function ReorderableLineList<T extends ReorderableLine>({
  lines,
  activeLine,
  onDragStart,
  onDragEnd,
  renderRow,
  renderOverlay
}: ReorderableLineListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={lines.map((l) => l.id!)}
        strategy={verticalListSortingStrategy}
      >
        <VStack spacing={0} className="w-full">
          {lines.map((line) => (
            <SortableLineRow key={line.id} line={line} renderRow={renderRow} />
          ))}
        </VStack>
      </SortableContext>
      <ClientOnly fallback={null}>
        {() =>
          createPortal(
            <DragOverlay>
              {activeLine && renderOverlay(activeLine)}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>
    </DndContext>
  );
}

function SortableLineRow<T extends ReorderableLine>({
  line,
  renderRow
}: {
  line: T;
  renderRow: (line: T, dragHandle: DragHandleBindings) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: line.id! });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full border-b bg-card ring-1 ring-transparent",
        isDragging && "opacity-50 ring-primary"
      )}
    >
      {renderRow(line, { attributes, listeners })}
    </div>
  );
}
