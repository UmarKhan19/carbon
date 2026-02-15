import { useCarbon } from "@carbon/auth";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import {
  formatStockDimensions,
  getStockRemaining,
  type MaterialStockAttributes,
  type MaterialStockPiece
} from "@carbon/utils";
import { useEffect, useState } from "react";
import { LuRuler, LuTriangleAlert } from "react-icons/lu";

type StockAvailabilityBadgeProps = {
  materialId: string | undefined;
  requiresDimensionTracking?: boolean;
};

/**
 * Shows a badge with stock availability for materials with dimensions.
 * Used in the MES materials list to indicate available stock pieces.
 */
export function StockAvailabilityBadge({
  materialId,
  requiresDimensionTracking = false
}: StockAvailabilityBadgeProps) {
  const { carbon } = useCarbon();
  const [stockPieces, setStockPieces] = useState<MaterialStockPiece[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!materialId || !carbon) {
      setStockPieces([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchStock = async () => {
      const result = await carbon
        .from("trackedEntity")
        .select("*")
        .eq("status", "Available")
        .eq("attributes->>materialId", materialId)
        .not("attributes->stockDimensions", "is", null);

      if (!cancelled && result.data) {
        const pieces: MaterialStockPiece[] = result.data
          .map((entity) => {
            const attrs =
              entity.attributes as unknown as MaterialStockAttributes;
            if (!attrs?.stockDimensions) return null;
            return {
              trackedEntityId: entity.id,
              stockDimensions: attrs.stockDimensions,
              stockUnit: attrs.stockUnit,
              status: entity.status as "Available" | "Reserved" | "On Hold",
              parentStockId: attrs.parentStockId ?? null
            };
          })
          .filter(Boolean) as MaterialStockPiece[];
        setStockPieces(pieces);
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    fetchStock();

    return () => {
      cancelled = true;
    };
  }, [materialId, carbon]);

  if (!materialId || isLoading) {
    return null;
  }

  // Show warning when dimension tracking required but no stock
  if (stockPieces.length === 0) {
    if (requiresDimensionTracking) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1">
              <LuTriangleAlert className="h-3 w-3" />
              No stock
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            This material requires dimension tracking but has no stock pieces.
            Add stock with dimensions before issuing.
          </TooltipContent>
        </Tooltip>
      );
    }
    return null;
  }

  const totalRemaining = stockPieces.reduce(
    (sum, piece) => sum + getStockRemaining(piece.stockDimensions),
    0
  );
  const unit = stockPieces[0]?.stockUnit ?? "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="gap-1 text-emerald-600">
          <LuRuler className="h-3 w-3" />
          {stockPieces.length} pc
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium">
            {stockPieces.length} stock piece
            {stockPieces.length !== 1 ? "s" : ""} available
          </span>
          <span className="text-muted-foreground">
            Total: {totalRemaining.toFixed(1)} {unit}
          </span>
          <div className="flex flex-col gap-0.5 mt-1">
            {stockPieces.slice(0, 3).map((piece) => (
              <span key={piece.trackedEntityId}>
                • {formatStockDimensions(piece.stockDimensions, piece.stockUnit)}
                {piece.parentStockId && " (remnant)"}
              </span>
            ))}
            {stockPieces.length > 3 && (
              <span className="text-muted-foreground">
                +{stockPieces.length - 3} more...
              </span>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
