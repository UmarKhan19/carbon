import type { useSortable } from "@dnd-kit/sortable";

export type ReorderableLine = {
  id: string | null | undefined;
};

export type DragHandleBindings = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};
