import type { ColumnDef } from "@tanstack/react-table";

// Resolve the body cell's clipping classes. Cells clip to a single line by
// default (whitespace-nowrap + truncate); a column may opt out via
// meta.cellClassName — e.g. to let label chips wrap onto multiple lines so the
// remove (×) button stays visible with 4+ labels.
export function getCellClipClassName(cellClassName?: string) {
  return cellClassName ?? "whitespace-nowrap truncate";
}

export function getAccessorKey<T>(columnDef: ColumnDef<T, unknown>) {
  return "accessorKey" in columnDef
    ? columnDef?.accessorKey.toString()
    : undefined;
}

export function updateNestedProperty(
  obj: object,
  path: string | string[],
  value: unknown
): unknown {
  if (typeof path == "string")
    return updateNestedProperty(obj, path.split("_"), value);
  else if (path.length == 1 && value !== undefined)
    // @ts-ignore
    return (obj[path[0]] = value);
  else if (path.length == 0) return obj;
  // @ts-ignore
  else return updateNestedProperty(obj[path[0]], path.slice(1), value);
}
