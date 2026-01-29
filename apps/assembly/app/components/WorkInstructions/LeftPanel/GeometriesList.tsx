import { cn } from "@carbon/react";

export interface GeometriesListProps {
  geometries: Record<string, number>;
  onGeometrySelect?: (name: string) => void;
  selectedGeometry?: string | null;
}

export function GeometriesList({
  geometries,
  onGeometrySelect,
  selectedGeometry
}: GeometriesListProps) {
  const sortedGeometries = Object.entries(geometries).sort(
    ([, a], [, b]) => b - a
  );
  const totalCount = sortedGeometries.reduce(
    (sum, [, count]) => sum + count,
    0
  );

  if (sortedGeometries.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Geometries
        </span>
        <span className="text-xs text-muted-foreground">
          {sortedGeometries.length} components · {totalCount} total
        </span>
      </div>

      {/* Geometry list */}
      <div className="max-h-48 overflow-y-auto">
        {sortedGeometries.map(([name, count]) => (
          <button
            key={name}
            type="button"
            onClick={() => onGeometrySelect?.(name)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors",
              selectedGeometry === name
                ? "bg-primary/10 text-foreground"
                : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="truncate flex-1 text-left">{name}</span>
            <span className="ml-2 text-xs tabular-nums bg-muted px-1.5 py-0.5 rounded">
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
