import { cn, Tr } from "@carbon/react";
import type { Column, Row as RowType } from "@tanstack/react-table";
import type { ComponentProps, CSSProperties } from "react";
import { memo } from "react";
import type {
  EditableTableCellComponent,
  Position
} from "~/components/Editable";
import Cell from "./Cell";

type RowProps<T> = ComponentProps<typeof Tr> & {
  editableComponents?: Record<string, EditableTableCellComponent<T> | object>;
  editedCells?: string[];
  isEditing: boolean;
  isEditMode: boolean;
  isFrozenColumn?: boolean;
  isRowSelected?: boolean;
  pinnedColumns: string;
  selectedCell: Position;
  row: RowType<T>;
  rowIsSelected: boolean;
  getPinnedStyles: (column: Column<any, unknown>) => CSSProperties;
  onCellClick: (row: number, column: number) => void;
  onCellUpdate: (row: number) => (updates: Record<string, unknown>) => void;
};

const Row = <T extends object>({
  editableComponents,
  editedCells,
  isEditing,
  isEditMode,
  isFrozenColumn = false,
  isRowSelected = false,
  pinnedColumns,
  row,
  rowIsSelected,
  selectedCell,
  getPinnedStyles,
  onCellClick,
  onCellUpdate,
  ...props
}: RowProps<T>) => {
  const onUpdate = isEditMode ? onCellUpdate(row.index) : undefined;

  const handleContextMenu = (event: React.MouseEvent<HTMLTableRowElement>) => {
    // Check if the right-click target or any parent is a link (anchor tag)
    let target = event.target as HTMLElement;
    while (target && target !== event.currentTarget) {
      if (target.tagName === "A") {
        // For links, stop propagation so ContextMenuTrigger doesn't show custom menu
        // This allows the browser's default context menu to appear
        event.stopPropagation();
        return;
      }
      target = target.parentElement as HTMLElement;
    }
    // For non-link clicks, event propagates normally to show custom context menu
  };

  return (
    <Tr
      key={row.id}
      className={cn(
        "border-b border-border transition-colors",
        isFrozenColumn && "bg-card"
      )}
      onContextMenu={handleContextMenu}
      {...props}
    >
      {row.getVisibleCells().map((cell, columnIndex) => {
        const isSelected =
          selectedCell?.row === cell.row.index &&
          selectedCell?.column === columnIndex;

        return (
          <Cell<T>
            key={cell.id}
            cell={cell}
            columnIndex={columnIndex}
            // @ts-ignore
            editableComponents={editableComponents}
            editedCells={editedCells}
            isRowSelected={isRowSelected}
            isSelected={isSelected}
            isEditing={isEditing}
            isEditMode={isEditMode}
            pinnedColumns={pinnedColumns}
            getPinnedStyles={getPinnedStyles}
            onClick={
              isEditMode
                ? () => onCellClick(cell.row.index, columnIndex)
                : undefined
            }
            onUpdate={onUpdate}
          />
        );
      })}
    </Tr>
  );
};

const MemoizedRow = memo(
  Row,
  (prev, next) =>
    next.rowIsSelected === false &&
    prev.rowIsSelected === false &&
    next.isRowSelected === prev.isRowSelected &&
    next.selectedCell?.row === prev.row.index &&
    next.row.index === prev.selectedCell?.row &&
    next.selectedCell?.column === prev.selectedCell?.column &&
    next.isEditing === prev.isEditing &&
    next.isEditMode === prev.isEditMode &&
    next.pinnedColumns === prev.pinnedColumns
) as typeof Row;

export default MemoizedRow;
