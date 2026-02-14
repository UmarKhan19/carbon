/**
 * Re-export material stock types from @carbon/utils.
 * This file exists for backward compatibility with existing imports.
 */
export {
  type LinearStock,
  type SheetStock,
  type BlockStock,
  type StockDimensions,
  type CutRecord,
  type MaterialStockAttributes,
  type MaterialStockPiece,
  type RecordCutParams,
  type RecordCutResult,
  type CreateMaterialStockParams,
  getStockRemaining,
  formatStockDimensions,
  buildStockDimensions
} from "@carbon/utils";
