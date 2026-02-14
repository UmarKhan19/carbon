/**
 * Material Stock Types and Utilities
 *
 * These types define the structure for tracking material stock with dimensions.
 * Stock dimensions represent the actual size of a piece of stock in inventory,
 * which changes when material is cut/consumed.
 *
 * This is distinct from "profile dimensions" (stored in materialDimension),
 * which describe the cross-section/shape and never change.
 */

// For bars, rods, tubes, angles - single dimension (length)
export type LinearStock = {
  type: "linear";
  length: number;
  originalLength: number;
};

// For sheets, plates - two dimensions (width x height)
export type SheetStock = {
  type: "sheet";
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};

// For blocks, thick plates - three dimensions (length x width x height)
export type BlockStock = {
  type: "block";
  length: number;
  width: number;
  height: number;
  originalLength: number;
  originalWidth: number;
  originalHeight: number;
};

export type StockDimensions = LinearStock | SheetStock | BlockStock;

export type CutRecord = {
  cutAt: string;
  cutBy: string;
  consumed: number;
  jobId?: string;
};

export type MaterialStockAttributes = {
  materialId: string;
  stockDimensions: StockDimensions;
  stockUnit: string;
  parentStockId?: string;
  cutHistory?: CutRecord[];
};

export type MaterialStockPiece = {
  trackedEntityId: string;
  stockDimensions: StockDimensions;
  stockUnit: string;
  status: "Available" | "Reserved" | "On Hold";
  shelfId?: string | null;
  locationId?: string | null;
  parentStockId?: string | null;
};

export type RecordCutParams = {
  sourceStockId: string;
  consumedAmount: number;
  jobMaterialId?: string;
  companyId: string;
  userId: string;
};

export type RecordCutResult = {
  success: boolean;
  activityId: string;
  remnantId?: string;
  consumedEntityId: string;
};

export type CreateMaterialStockParams = {
  materialId: string;
  stockDimensions: StockDimensions;
  stockUnit: string;
  quantity?: number;
  sourceDocument?: string;
  sourceDocumentId?: string;
};

export function getStockRemaining(dimensions: StockDimensions): number {
  switch (dimensions.type) {
    case "linear":
      return dimensions.length;
    case "sheet":
      return dimensions.width * dimensions.height;
    case "block":
      return dimensions.length * dimensions.width * dimensions.height;
  }
}

export function formatStockDimensions(
  dimensions: StockDimensions,
  unit: string
): string {
  switch (dimensions.type) {
    case "linear":
      return `${dimensions.length} ${unit}`;
    case "sheet":
      return `${dimensions.width} x ${dimensions.height} ${unit}`;
    case "block":
      return `${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${unit}`;
  }
}

/**
 * Build the full stock dimensions object with original values set
 * from the initial dimensions input.
 */
export function buildStockDimensions(
  input:
    | { type: "linear"; length: number }
    | { type: "sheet"; width: number; height: number }
    | { type: "block"; length: number; width: number; height: number }
): StockDimensions {
  switch (input.type) {
    case "linear":
      return {
        type: "linear",
        length: input.length,
        originalLength: input.length
      };
    case "sheet":
      return {
        type: "sheet",
        width: input.width,
        height: input.height,
        originalWidth: input.width,
        originalHeight: input.height
      };
    case "block":
      return {
        type: "block",
        length: input.length,
        width: input.width,
        height: input.height,
        originalLength: input.length,
        originalWidth: input.width,
        originalHeight: input.height
      };
  }
}
