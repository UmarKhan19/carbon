import { Badge, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";

// =============================================================================
// RedlineDiff — a change-order redline of an item's method between its current
// revision and the in-progress (pending) revision.
//
// Materials (BOM) are matched on a stable key path, operations (BOP) on
// order/description. Each changed row leads with a colored kind badge
// (Added = green, Removed = red, Changed = amber), the item name, its readable
// id, and the field values that moved (old → new).
// =============================================================================

export type Material = {
  // Stable diff key (a path like `parentKey>itemId`) so the same item appearing
  // at multiple BOM levels never collides. Falls back to itemId when absent.
  key?: string | null;
  // 0 = top-level material; deeper levels come from flattened sub-assemblies.
  level?: number | null;
  itemId?: string | null;
  itemReadableId?: string | null;
  // The item's name (populated from item.name in the snapshot builder).
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
  // Secondary identifier shown muted next to the title (e.g. the readable id).
  subtitle?: string;
  fields: DiffField[];
  // BOM nesting depth (materials only); used to indent nested rows.
  level?: number;
};

const KIND_BADGE: Record<
  Exclude<DiffKind, "unchanged">,
  { variant: ComponentProps<typeof Badge>["variant"]; label: ReactNode }
> = {
  added: { variant: "green", label: <Trans>Added</Trans> },
  removed: { variant: "red", label: <Trans>Removed</Trans> },
  changed: { variant: "yellow", label: <Trans>Changed</Trans> }
};

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function materialName(m: Material): string {
  return m.description ?? m.itemReadableId ?? m.itemId ?? "Material";
}

function materialSubtitle(m: Material): string | undefined {
  const id = m.itemReadableId ?? m.itemId ?? undefined;
  // Only show the id as a subtitle when it isn't already the title.
  return id && id !== materialName(m) ? id : undefined;
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
  options?: {
    levelOf?: (item: T) => number | undefined;
    subtitleOf?: (item: T) => string | undefined;
  }
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
      subtitle: options?.subtitleOf?.(source),
      fields: fieldsOf(before, after, kind),
      level: options?.levelOf?.(source)
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
    (m) => m.key ?? m.itemId ?? m.itemReadableId ?? materialName(m),
    materialName,
    (before, after, kind) => [
      buildField("Qty", fmt(before?.quantity), fmt(after?.quantity), kind),
      buildField(
        "UoM",
        fmt(before?.unitOfMeasureCode),
        fmt(after?.unitOfMeasureCode),
        kind
      )
    ],
    {
      levelOf: (m) => m.level ?? undefined,
      subtitleOf: materialSubtitle
    }
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
      )
    ]
  );
}

function FieldValue({ field, kind }: { field: DiffField; kind: DiffKind }) {
  if (kind === "added") {
    return (
      <span>
        {field.label} {field.pending}
      </span>
    );
  }
  if (kind === "removed") {
    return (
      <span>
        {field.label} {field.current}
      </span>
    );
  }
  if (!field.changed) {
    return (
      <span>
        {field.label} {field.current}
      </span>
    );
  }
  return (
    <span>
      {field.label} {field.current}{" "}
      <span className="font-medium text-foreground">→ {field.pending}</span>
    </span>
  );
}

function DiffRowLine({ row }: { row: DiffRow }) {
  const level = row.level ?? 0;
  const badge = row.kind === "unchanged" ? null : KIND_BADGE[row.kind];
  const fields =
    row.kind === "changed" ? row.fields.filter((f) => f.changed) : row.fields;

  return (
    <li
      className="flex items-start gap-3 py-2"
      style={level > 0 ? { paddingLeft: level * 16 } : undefined}
    >
      {badge && (
        <Badge variant={badge.variant} className="mt-0.5 shrink-0">
          {badge.label}
        </Badge>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-medium truncate">{row.title}</span>
          {row.subtitle && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {row.subtitle}
            </span>
          )}
        </div>
        {fields.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {fields.map((f) => (
              <FieldValue key={f.label} field={f} kind={row.kind} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function DiffSection({ title, rows }: { title: ReactNode; rows: DiffRow[] }) {
  const changedRows = rows.filter((r) => r.kind !== "unchanged");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {changedRows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/50">
          {changedRows.map((row) => (
            <DiffRowLine key={row.key} row={row} />
          ))}
        </ul>
      ) : (
        <span className="text-xs text-muted-foreground">
          <Trans>No changes</Trans>
        </span>
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

// Pure helper (no React) so loaders can compute the added/removed/changed signal
// for a method pair without rendering the diff. Reuses the same row builders +
// countByKind the component uses, so the sidebar badge and the diff body never
// disagree.
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
    <div
      className={cn(
        "flex flex-col gap-5 rounded-lg border border-border bg-card p-4",
        !hasChanges && "items-center justify-center py-10 text-center"
      )}
    >
      {hasChanges ? (
        <>
          <DiffSection
            title={<Trans>Materials (BOM)</Trans>}
            rows={materialRows}
          />
          <DiffSection
            title={<Trans>Operations (BOP)</Trans>}
            rows={operationRows}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>No method changes between revisions.</Trans>
        </p>
      )}
    </div>
  );
}
