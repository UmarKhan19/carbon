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

export type LinearStock = {
  type: "linear";
  length: number;
  width: 1;
  height: 1;
  originalLength: number;
  originalWidth: 1;
  originalHeight: 1;
};

export type SheetStock = {
  type: "sheet";
  length: number;
  width: number;
  height: 1;
  originalLength: number;
  originalWidth: number;
  originalHeight: 1;
};

export type RollStock = {
  type: "roll";
  length: number;
  width: number;
  height: 1;
  originalLength: number;
  originalWidth: number;
  originalHeight: 1;
};

// Kept for backward compatibility with already-created block records.
export type BlockStock = {
  type: "block";
  length: number;
  width: number;
  height: number;
  originalLength: number;
  originalWidth: number;
  originalHeight: number;
};

export type StockDimensions = LinearStock | SheetStock | RollStock | BlockStock;

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
  consumedAmount?: number;
  remnantDimensions?: {
    length: number;
    width: number;
    height: number;
  };
  planned?: {
    consumedAmount?: number;
    note?: string;
  };
  actual?: {
    consumedAmount: number;
    varianceReason?: string;
    note?: string;
  };
  outputs?: Array<{
    kind: "remnant" | "scrap";
    quantity?: number;
    dimensions?: {
      length: number;
      width: number;
      height: number;
    };
    consumedAmount?: number;
    note?: string;
  }>;
  jobMaterialId?: string;
  companyId: string;
  userId: string;
};

export type RecordCutResult = {
  success: boolean;
  activityId: string;
  remnantId?: string;
  remnantIds?: string[];
  outputEntityIds?: string[];
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

export type RequiredStockDimensions = {
  length?: number;
  width?: number;
  height?: number;
};

export function getStockRemaining(dimensions: StockDimensions): number {
  switch (dimensions.type) {
    case "linear":
      return dimensions.length;
    case "sheet":
    case "roll":
      return dimensions.length * dimensions.width;
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
      return `${dimensions.length} x ${dimensions.width} ${unit}`;
    case "roll":
      return `${dimensions.length} x ${dimensions.width} ${unit} (roll)`;
    case "block":
      return `${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${unit}`;
  }
}

export function isStockCompatible(
  dimensions: StockDimensions,
  required: RequiredStockDimensions
): boolean {
  if (required.length !== undefined && dimensions.length < required.length) {
    return false;
  }

  if (required.width !== undefined) {
    if (dimensions.type === "linear" || dimensions.width < required.width) {
      return false;
    }
  }

  if (required.height !== undefined) {
    if (dimensions.type !== "block" || dimensions.height < required.height) {
      return false;
    }
  }

  return true;
}

/**
 * Build the full stock dimensions object with original values set
 * from the initial dimensions input.
 */
export function buildStockDimensions(
  input:
    | { type: "linear"; length: number }
    | { type: "sheet"; length: number; width: number }
    | { type: "roll"; length: number; width: number }
    | { type: "block"; length: number; width: number; height: number }
): StockDimensions {
  switch (input.type) {
    case "linear":
      return {
        type: "linear",
        length: input.length,
        width: 1,
        height: 1,
        originalLength: input.length,
        originalWidth: 1,
        originalHeight: 1
      };
    case "sheet":
      return {
        type: "sheet",
        length: input.length,
        width: input.width,
        height: 1,
        originalLength: input.length,
        originalWidth: input.width,
        originalHeight: 1
      };
    case "roll":
      return {
        type: "roll",
        length: input.length,
        width: input.width,
        height: 1,
        originalLength: input.length,
        originalWidth: input.width,
        originalHeight: 1
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
