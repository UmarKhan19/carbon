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

// Stock dimensions - always block with three dimensions (length x width x height)
export type StockDimensions = {
  length: number;
  width: number;
  height: number;
  originalLength: number;
  originalWidth: number;
  originalHeight: number;
};

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
  status: "Available" | "Reserved" | "On Hold" | "Consumed";
  shelfId?: string | null;
  locationId?: string | null;
  parentStockId?: string | null;
};

export type RecordCutParams = {
  sourceStockId: string;
  consumedAmount: number;
  remnantDimensions?: {
    length: number;
    width: number;
    height: number;
  };
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
  // Simplified model: always calculate volume (L x W x H)
  return dimensions.length * dimensions.width * dimensions.height;
}

export function formatStockDimensions(
  dimensions: StockDimensions,
  unit: string
): string {
  // Simplified model: always display as L x W x H
  return `${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${unit}`;
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
