import { useCarbon } from "@carbon/auth";
import {
  Badge,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import {
  formatStockDimensions,
  getStockRemaining,
  type MaterialStockAttributes,
  type MaterialStockPiece
} from "@carbon/utils";
import { useEffect, useState } from "react";
import { LuRuler, LuTriangleAlert } from "react-icons/lu";

type StockAvailabilityProps = {
  materialId: string | undefined;
  showPopover?: boolean;
  requiresDimensionTracking?: boolean;
};

/**
 * Displays stock availability with dimensions for a material.
 * Shows a badge with count of available stock pieces.
 * Click to see detailed list with dimensions.
 */
export function StockAvailability({
  materialId,
  showPopover = true,
  requiresDimensionTracking = false
}: StockAvailabilityProps) {
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
            const attrs = entity.attributes as unknown as MaterialStockAttributes;
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

  // Show warning when dimension tracking is required but no stock exists
  if (!materialId || isLoading) {
    return null;
  }

  if (stockPieces.length === 0) {
    if (requiresDimensionTracking) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1">
              <LuTriangleAlert className="h-3 w-3" />
              No stock (required)
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

  const content = (
    <Badge variant="outline" className="gap-1 cursor-pointer">
      <LuRuler className="h-3 w-3" />
      {stockPieces.length} pc ({totalRemaining.toFixed(1)} {unit})
    </Badge>
  );

  if (!showPopover) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <VStack spacing={1} className="text-xs">
            <span className="font-medium">Available Stock with Dimensions</span>
            {stockPieces.slice(0, 5).map((piece) => (
              <span key={piece.trackedEntityId}>
                {formatStockDimensions(piece.stockDimensions, piece.stockUnit)}
                {piece.parentStockId && " (remnant)"}
              </span>
            ))}
            {stockPieces.length > 5 && (
              <span className="text-muted-foreground">
                +{stockPieces.length - 5} more
              </span>
            )}
          </VStack>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{content}</PopoverTrigger>
      <PopoverContent className="w-72">
        <VStack spacing={2}>
          <div className="font-medium text-sm">Available Stock</div>
          <div className="text-xs text-muted-foreground">
            {stockPieces.length} piece{stockPieces.length !== 1 ? "s" : ""} with
            tracked dimensions
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto w-full">
            {stockPieces.map((piece) => (
              <HStack
                key={piece.trackedEntityId}
                className="justify-between text-xs p-2 bg-muted/50 rounded"
              >
                <span className="font-medium">
                  {formatStockDimensions(
                    piece.stockDimensions,
                    piece.stockUnit
                  )}
                </span>
                <HStack spacing={1}>
                  {piece.parentStockId && (
                    <Badge variant="outline" className="text-[10px] px-1">
                      Remnant
                    </Badge>
                  )}
                  <span className="text-muted-foreground font-mono">
                    {piece.trackedEntityId.slice(0, 8)}
                  </span>
                </HStack>
              </HStack>
            ))}
          </div>
          <div className="text-xs text-muted-foreground pt-1 border-t w-full">
            Total: {totalRemaining.toFixed(1)} {unit} available
          </div>
        </VStack>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact inline display of stock availability
 */
export function StockAvailabilityInline({
  materialId,
  requiresDimensionTracking = false,
  requiredLength,
  requiredWidth,
  requiredHeight
}: {
  materialId: string | undefined;
  requiresDimensionTracking?: boolean;
  requiredLength?: number;
  requiredWidth?: number;
  requiredHeight?: number;
}) {
  const { carbon } = useCarbon();
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [unit, setUnit] = useState("");
  const [hasSufficientStock, setHasSufficientStock] = useState(false);

  useEffect(() => {
    if (!materialId || !carbon) {
      setCount(0);
      setHasSufficientStock(false);
      return;
    }

    const fetchStock = async () => {
      const result = await carbon
        .from("trackedEntity")
        .select("attributes")
        .eq("status", "Available")
        .eq("attributes->>materialId", materialId)
        .not("attributes->stockDimensions", "is", null);

      if (result.data) {
        let totalAmt = 0;
        let stockUnit = "";
        let hasValidPiece = false;

        result.data.forEach((entity) => {
          const attrs = entity.attributes as unknown as MaterialStockAttributes;
          if (attrs?.stockDimensions) {
            totalAmt += getStockRemaining(attrs.stockDimensions);
            if (!stockUnit) stockUnit = attrs.stockUnit;

            // Check if this piece can fulfill the required dimensions
            if (
              requiredLength !== undefined &&
              requiredWidth !== undefined &&
              requiredHeight !== undefined
            ) {
              const dims = attrs.stockDimensions;
              if (
                dims.length >= requiredLength &&
                dims.width >= requiredWidth &&
                dims.height >= requiredHeight
              ) {
                hasValidPiece = true;
              }
            } else {
              // If no required dimensions specified, any stock is valid
              hasValidPiece = true;
            }
          }
        });
        setCount(result.data.length);
        setTotal(totalAmt);
        setUnit(stockUnit);
        setHasSufficientStock(hasValidPiece);
      }
    };

    fetchStock();
  }, [materialId, carbon, requiredLength, requiredWidth, requiredHeight]);

  if (count === 0) {
    if (requiresDimensionTracking) {
      return (
        <span className="text-xs text-destructive flex items-center gap-1">
          <LuTriangleAlert className="h-3 w-3" />
          No stock (required)
        </span>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        No stock pieces
      </span>
    );
  }

  // If we have required dimensions but no piece is large enough
  if (
    requiresDimensionTracking &&
    requiredLength !== undefined &&
    requiredWidth !== undefined &&
    requiredHeight !== undefined &&
    !hasSufficientStock
  ) {
    return (
      <span className="text-xs text-destructive flex items-center gap-1">
        <LuTriangleAlert className="h-3 w-3" />
        No stock with required dimensions
      </span>
    );
  }

  return (
    <span className="text-xs text-emerald-600">
      {count} stock ({total.toFixed(1)} {unit})
    </span>
  );
}
