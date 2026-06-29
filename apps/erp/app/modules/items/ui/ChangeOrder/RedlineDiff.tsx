import { Badge, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

// =============================================================================
// RedlineDiff — a Duro-style GitHub *unified* diff of an item's method between
// its current revision and the in-progress (pending) revision.
//
// Materials (BOM) are matched on itemId, operations (BOP) on order/description.
// Each side is rendered as ONE flat list of rows carrying a +/−/~ marker and a
// row tint (added = green, removed = red, changed = amber) using the codebase's
// existing Badge color variants (green/red/yellow) and semantic text classes.
// =============================================================================

export type Material = {
  // Stable diff key (a path like `parentKey>itemId`) so the same item appearing
  // at multiple BOM levels never collides. Falls back to itemId when absent.
  key?: string | null;
  // 0 = top-level material; deeper levels come from flattened sub-assemblies.
  level?: number | null;
  itemId?: string | null;
  itemReadableId?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitOfMeasureCode?: string | null;
};

export type Operation = {
  description?: string | null;
  order?: number | null;
  workCenter?: string | null;
};

export type Method = {
  materials?: Material[] | null;
  operations?: Operation[] | null;
};

type DiffKind = "added" | "removed" | "changed" | "unchanged";

type DiffField = {
  label: string;
  current: string;
  pending: string;
  changed: boolean;
};

type DiffRow = {
  key: string;
  kind: DiffKind;
  title: string;
  fields: DiffField[];
  // BOM nesting depth (materials only); used to indent nested rows.
  level?: number;
};

const MARKERS: Record<Exclude<DiffKind, "unchanged">, string> = {
  added: "+",
  removed: "−",
  changed: "~"
};

const ROW_CLASSES: Record<DiffKind, string> = {
  added:
    "bg-emerald-100/50 dark:bg-emerald-500/10 border-l-2 border-emerald-500/60",
  removed: "bg-red-100/50 dark:bg-red-500/10 border-l-2 border-red-500/60",
  changed:
    "bg-yellow-100/50 dark:bg-yellow-500/10 border-l-2 border-yellow-500/60",
  unchanged: "border-l-2 border-transparent"
};

const MARKER_CLASSES: Record<DiffKind, string> = {
  added: "text-emerald-600 dark:text-emerald-400",
  removed: "text-red-600 dark:text-red-400",
  changed: "text-yellow-600 dark:text-yellow-500",
  unchanged: "text-muted-foreground"
};

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function materialTitle(m: Material): string {
  return m.itemReadableId ?? m.itemId ?? "Material";
}

function operationTitle(o: Operation): string {
  return (
    o.description ?? (o.order != null ? `Operation ${o.order}` : "Operation")
  );
}

function buildField(
  label: string,
  current: string,
  pending: string,
  kind: DiffKind
): DiffField {
  return {
    label,
    current,
    pending,
    changed: kind === "changed" && current !== pending
  };
}

// Diff two keyed collections into one flat ordered list (removed/changed/added).
function diffRows<T>(
  current: T[],
  pending: T[],
  keyOf: (item: T) => string,
  titleOf: (item: T) => string,
  fieldsOf: (
    current: T | null,
    pending: T | null,
    kind: DiffKind
  ) => DiffField[],
  levelOf?: (item: T) => number | undefined
): DiffRow[] {
  const currentByKey = new Map(current.map((item) => [keyOf(item), item]));
  const pendingByKey = new Map(pending.map((item) => [keyOf(item), item]));

  const rows: DiffRow[] = [];
  const seen = new Set<string>();

  // Walk current first so removed/unchanged keep their original order, then
  // append the keys that only exist on the pending side (added).
  const orderedKeys = [
    ...current.map(keyOf),
    ...pending.map(keyOf).filter((k) => !currentByKey.has(k))
  ];

  for (const key of orderedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);

    const before = currentByKey.get(key) ?? null;
    const after = pendingByKey.get(key) ?? null;

    let kind: DiffKind;
    if (before && !after) kind = "removed";
    else if (!before && after) kind = "added";
    else {
      const fields = fieldsOf(before, after, "changed");
      kind = fields.some((f) => f.changed) ? "changed" : "unchanged";
    }

    const source = (after ?? before) as T;
    rows.push({
      key,
      kind,
      title: titleOf(source),
      fields: fieldsOf(before, after, kind),
      level: levelOf?.(source)
    });
  }

  return rows;
}

function buildMaterialRows(
  current: Material[],
  pending: Material[]
): DiffRow[] {
  return diffRows<Material>(
    current,
    pending,
    // Key on the stable multi-level path so the same item at different BOM
    // levels never collides; fall back to itemId for flat (legacy) inputs.
    (m) => m.key ?? m.itemId ?? m.itemReadableId ?? materialTitle(m),
    materialTitle,
    (before, after, kind) => [
      buildField("Qty", fmt(before?.quantity), fmt(after?.quantity), kind),
      buildField(
        "UoM",
        fmt(before?.unitOfMeasureCode),
        fmt(after?.unitOfMeasureCode),
        kind
      ),
      buildField(
        "Description",
        fmt(before?.description),
        fmt(after?.description),
        kind
      )
    ],
    (m) => m.level ?? undefined
  );
}

function buildOperationRows(
  current: Operation[],
  pending: Operation[]
): DiffRow[] {
  return diffRows<Operation>(
    current,
    pending,
    (o) => `${o.order ?? ""}|${o.description ?? ""}`,
    operationTitle,
    (before, after, kind) => [
      buildField("Sequence", fmt(before?.order), fmt(after?.order), kind),
      buildField(
        "Work Center",
        fmt(before?.workCenter),
        fmt(after?.workCenter),
        kind
      ),
      buildField(
        "Description",
        fmt(before?.description),
        fmt(after?.description),
        kind
      )
    ]
  );
}

function FieldValue({ field }: { field: DiffField }) {
  if (!field.changed) {
    return (
      <span className="text-foreground/80">
        {field.label}: {field.current}
      </span>
    );
  }
  return (
    <span>
      {field.label}:{" "}
      <span className="text-red-600 line-through dark:text-red-400">
        {field.current}
      </span>{" "}
      <span className="text-emerald-600 dark:text-emerald-400">
        {field.pending}
      </span>
    </span>
  );
}

function DiffRowLine({ row }: { row: DiffRow }) {
  const marker = row.kind === "unchanged" ? " " : MARKERS[row.kind];
  const level = row.level ?? 0;
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-2 text-sm",
        ROW_CLASSES[row.kind]
      )}
    >
      <span
        className={cn(
          "font-mono font-bold w-3 select-none shrink-0",
          MARKER_CLASSES[row.kind]
        )}
        aria-hidden
      >
        {marker}
      </span>
      {/* Indent nested sub-assembly materials by their BOM level. */}
      {level > 0 && (
        <span
          aria-hidden
          className="shrink-0 self-stretch border-l border-border/60"
          style={{ marginLeft: (level - 1) * 16, width: 16 }}
        />
      )}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className="font-medium truncate">{row.title}</span>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {row.kind === "removed"
            ? row.fields.map((f) => (
                <span key={f.label} className="text-foreground/70">
                  {f.label}: {f.current}
                </span>
              ))
            : row.kind === "added"
              ? row.fields.map((f) => (
                  <span key={f.label} className="text-foreground/70">
                    {f.label}: {f.pending}
                  </span>
                ))
              : row.fields.map((f) => <FieldValue key={f.label} field={f} />)}
        </div>
      </div>
    </li>
  );
}

function DiffSection({
  title,
  rows
}: {
  title: React.ReactNode;
  rows: DiffRow[];
}) {
  const changedRows = rows.filter((r) => r.kind !== "unchanged");
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {changedRows.length === 0 && (
          <span className="text-xs text-muted-foreground">
            <Trans>No changes</Trans>
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/60">
          {rows.map((row) => (
            <DiffRowLine key={row.key} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function countByKind(rows: DiffRow[]) {
  return rows.reduce(
    (acc, r) => {
      if (r.kind === "added") acc.added += 1;
      else if (r.kind === "removed") acc.removed += 1;
      else if (r.kind === "changed") acc.changed += 1;
      return acc;
    },
    { added: 0, removed: 0, changed: 0 }
  );
}

export type RedlineCounts = { added: number; removed: number; changed: number };

// Pure helper (no React) so loaders can compute the +/−/~ signal for a method
// pair without rendering the diff. Reuses the same row builders + countByKind
// the component uses, so the sidebar badge and the diff body never disagree.
export function getRedlineCounts(
  current: Method,
  pending: Method
): RedlineCounts {
  const materialRows = buildMaterialRows(
    current?.materials ?? [],
    pending?.materials ?? []
  );
  const operationRows = buildOperationRows(
    current?.operations ?? [],
    pending?.operations ?? []
  );
  return countByKind([...materialRows, ...operationRows]);
}

export default function RedlineDiff({
  current,
  pending
}: {
  current: Method;
  pending: Method;
}) {
  const materialRows = buildMaterialRows(
    current?.materials ?? [],
    pending?.materials ?? []
  );
  const operationRows = buildOperationRows(
    current?.operations ?? [],
    pending?.operations ?? []
  );

  const totals = countByKind([...materialRows, ...operationRows]);
  const hasChanges =
    totals.added > 0 || totals.removed > 0 || totals.changed > 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold">
          <Trans>Redline</Trans>
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <Badge variant="green">{totals.added} added</Badge>
          <Badge variant="red">{totals.removed} removed</Badge>
          <Badge variant="yellow">{totals.changed} changed</Badge>
        </div>
      </div>
      {hasChanges ? (
        <div className="flex flex-col">
          <DiffSection
            title={<Trans>Materials (BOM)</Trans>}
            rows={materialRows}
          />
          <DiffSection
            title={<Trans>Operations (BOP)</Trans>}
            rows={operationRows}
          />
        </div>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          <Trans>No method changes between revisions.</Trans>
        </div>
      )}
    </div>
  );
}
