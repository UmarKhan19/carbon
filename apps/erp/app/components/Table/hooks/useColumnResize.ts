import { useCallback, useState } from "react";
import type { ColumnSizeMap } from "../types";

const MIN_COLUMN_WIDTH = 120;

interface UseColumnResizeReturn {
  columnSizes: Map<string, number>;
  handleColumnResize: (
    columnId: string,
    delta: number,
    startWidth: number
  ) => void;
  getColumnWidth: (columnId: string, defaultWidth: number) => number;
  resetColumnSizes: () => void;
}

export const useColumnResize = (
  initialSizes?: Map<string, number>
): UseColumnResizeReturn => {
  const [columnSizes, setColumnSizes] = useState<Map<string, number>>(
    initialSizes ?? new Map()
  );

  const handleColumnResize = useCallback(
    (columnId: string, delta: number, startWidth: number) => {
      setColumnSizes((prev) => {
        const newSizes = new Map(prev);
        const currentWidth = newSizes.get(columnId) ?? startWidth;
        const newWidth = Math.max(MIN_COLUMN_WIDTH, currentWidth + delta);
        newSizes.set(columnId, newWidth);
        return newSizes;
      });
    },
    []
  );

  const getColumnWidth = useCallback(
    (columnId: string, defaultWidth: number): number => {
      return columnSizes.get(columnId) ?? defaultWidth;
    },
    [columnSizes]
  );

  const resetColumnSizes = useCallback(() => {
    setColumnSizes(new Map());
  }, []);

  return {
    columnSizes,
    handleColumnResize,
    getColumnWidth,
    resetColumnSizes
  };
};
