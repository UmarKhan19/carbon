import { cn, HStack, VStack } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useItems } from "~/stores";
import type {
  ChangeOrderItemDiff,
  MethodDiffEntry,
  MethodDiffStatus,
  OperationDiffEntry
} from "../../changeOrder.models";
import { DiffBadge } from "./diff-ui";

// -----------------------------------------------------------------------------
// Read-only Change Order diff viewer (authoring-time). Renders the CO-owned draft
// method vs the base Active method it was copied from as a git-style, tree-shaped
// redline: BOM and BOP as SEPARATE sections plus an Attributes section, each entry
// colored in the audit-log red→green style. Unchanged rows are filtered out; an
// unchanged operation is shown (uncolored) only when its children changed.
//
// This is NOT the release merge UI (ChangeOrderReleaseMerge / ...ConflictResolver,
// which have radio-button choices) — it is purely read-only, no forms, no state.
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Items = ReturnType<typeof useItems>[0];

// Humanized labels shared with the merge resolver's FIELD_LABELS, extended with
// the item-attribute columns the attribute diff surfaces.
const FIELD_LABELS: Record<string, string> = {
  quantity: "Quantity",
  unitOfMeasureCode: "Unit",
  order: "Sequence",
  description: "Description",
  workCenterId: "Work center",
  procedureId: "Procedure",
  operationSupplierProcessId: "Supplier process",
  operationLeadTime: "Lead time",
  operationUnitCost: "Unit cost",
  operationMinimumCost: "Minimum cost",
  setupTime: "Setup time",
  laborTime: "Labor time",
  machineTime: "Machine time",
  methodType: "Method",
  workInstruction: "Work instructions",
  name: "Name",
  itemTrackingType: "Tracking",
  replenishmentSystem: "Replenishment",
  sourcingType: "Sourcing",
  requiresInspection: "Requires inspection",
  defaultMethodType: "Default method",
  thumbnailPath: "Thumbnail",
  key: "Parameter",
  toolId: "Tool"
};

function humanizeField(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  // JSON columns (workInstruction, etc.) — don't dump raw structure.
  if (field === "workInstruction" || typeof value === "object") return "Set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// The audit-log red/green pill (mirrors AuditLogDrawer's ChangePill).
function Pill({
  variant,
  children
}: {
  variant: "old" | "new";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-xs",
        variant === "old"
          ? "bg-red-500/10 text-red-500"
          : "bg-green-500/10 text-green-500"
      )}
    >
      {children}
    </span>
  );
}

// One "label: [old] → [new]" line for a modified field.
function FieldRow({
  field,
  before,
  after
}: {
  field: string;
  before: unknown;
  after: unknown;
}) {
  return (
    <div className="flex items-center gap-2 text-xs pl-4">
      <span className="text-muted-foreground min-w-[6rem]">
        {humanizeField(field)}
      </span>
      <Pill variant="old">{formatValue(field, before)}</Pill>
      <span className="text-muted-foreground">→</span>
      <Pill variant="new">{formatValue(field, after)}</Pill>
    </div>
  );
}

// One-sided context row for an added (all green) or removed (all red) entry — the
// "either they are all new, or they are modified" case.
function ContextRow({
  fields,
  row,
  variant
}: {
  fields: string[];
  row: Row | null;
  variant: "old" | "new";
}) {
  if (!row) return null;
  const shown = fields.filter(
    (f) => row[f] !== null && row[f] !== undefined && row[f] !== ""
  );
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pl-4">
      {shown.map((f) => (
        <span key={f} className="flex items-center gap-1">
          <span className="text-muted-foreground">{humanizeField(f)}</span>
          <Pill variant={variant}>{formatValue(f, row[f])}</Pill>
        </span>
      ))}
    </div>
  );
}

// The entry title line: colored green (added) / red + strikethrough (removed);
// no color for modified or an unchanged-with-changed-children operation.
function EntryHeader({
  label,
  status
}: {
  label: ReactNode;
  status: MethodDiffStatus;
}) {
  const colored =
    status === "added"
      ? "bg-green-500/10 text-green-500"
      : status === "removed"
        ? "bg-red-500/10 text-red-500 line-through"
        : null;
  return (
    <HStack className="justify-between w-full">
      <span
        className={cn("text-sm", colored && `px-2 py-0.5 rounded ${colored}`)}
      >
        {label}
      </span>
      <DiffBadge status={status} />
    </HStack>
  );
}

const MATERIAL_CONTEXT = ["quantity", "unitOfMeasureCode"];
const OPERATION_CONTEXT = ["order", "workCenterId"];

function modifiedFieldRows(entry: MethodDiffEntry<Row>): ReactNode {
  if (!entry.changedFields) return null;
  return Object.entries(entry.changedFields).map(
    ([field, { before, after }]) => (
      <FieldRow key={field} field={field} before={before} after={after} />
    )
  );
}

function MaterialEntry({
  entry,
  items
}: {
  entry: MethodDiffEntry<Row>;
  items: Items;
}) {
  const row = (entry.after ?? entry.before) as Row | null;
  const itemId = (row?.itemId as string | undefined) ?? "";
  const label = getItemReadableId(items, itemId) || itemId || "Material";
  return (
    <VStack spacing={1} className="w-full">
      <EntryHeader label={label} status={entry.status} />
      {entry.status === "modified" && modifiedFieldRows(entry)}
      {entry.status === "added" && (
        <ContextRow
          fields={MATERIAL_CONTEXT}
          row={entry.after as Row}
          variant="new"
        />
      )}
      {entry.status === "removed" && (
        <ContextRow
          fields={MATERIAL_CONTEXT}
          row={entry.before as Row}
          variant="old"
        />
      )}
    </VStack>
  );
}

// The three operation-child buckets, each with a label extractor for its rows.
const CHILD_BUCKETS: {
  key: "steps" | "parameters" | "tools";
  title: ReactNode;
  labelOf: (row: Row | null) => string;
}[] = [
  {
    key: "steps",
    title: <Trans>Steps</Trans>,
    labelOf: (r) => (r?.name as string) || (r?.description as string) || "Step"
  },
  {
    key: "parameters",
    title: <Trans>Parameters</Trans>,
    labelOf: (r) => (r?.key as string) || "Parameter"
  },
  {
    key: "tools",
    title: <Trans>Tools</Trans>,
    labelOf: (r) => (r?.toolId as string) || "Tool"
  }
];

function operationHasChildChanges(entry: OperationDiffEntry): boolean {
  const c = entry.children;
  if (!c) return false;
  return [c.steps, c.parameters, c.tools].some((arr) =>
    arr.some((r) => r.status !== "unchanged")
  );
}

function OperationEntry({ entry }: { entry: OperationDiffEntry }) {
  const row = (entry.after ?? entry.before) as Row | null;
  const label =
    (row?.description as string) || `Operation ${row?.order ?? ""}`.trim();
  const children = entry.children;
  return (
    <VStack spacing={1} className="w-full">
      <EntryHeader label={label} status={entry.status} />
      {entry.status === "modified" && modifiedFieldRows(entry)}
      {entry.status === "added" && (
        <ContextRow
          fields={OPERATION_CONTEXT}
          row={entry.after as Row}
          variant="new"
        />
      )}
      {entry.status === "removed" && (
        <ContextRow
          fields={OPERATION_CONTEXT}
          row={entry.before as Row}
          variant="old"
        />
      )}
      {children &&
        CHILD_BUCKETS.map((bucket) => {
          const changed = children[bucket.key].filter(
            (c) => c.status !== "unchanged"
          );
          if (changed.length === 0) return null;
          return (
            <div key={bucket.key} className="pl-4 w-full">
              <div className="text-[0.65rem] font-medium uppercase text-muted-foreground pb-0.5">
                {bucket.title}
              </div>
              <VStack spacing={1} className="w-full">
                {changed.map((child, i) => {
                  const childRow = (child.after ?? child.before) as Row | null;
                  return (
                    <VStack
                      key={`${bucket.key}-${i}`}
                      spacing={1}
                      className="w-full"
                    >
                      <EntryHeader
                        label={bucket.labelOf(childRow)}
                        status={child.status}
                      />
                      {child.status === "modified" && modifiedFieldRows(child)}
                    </VStack>
                  );
                })}
              </VStack>
            </div>
          );
        })}
    </VStack>
  );
}

function Section({
  title,
  children
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </div>
      {children}
    </VStack>
  );
}

export default function ChangeOrderDiffViewer({
  diff
}: {
  diff?: ChangeOrderItemDiff;
}) {
  const [items] = useItems();

  const materials = (diff?.materials ?? []).filter(
    (m) => m.status !== "unchanged"
  );
  const operations = (diff?.operations ?? []).filter(
    (o) => o.status !== "unchanged" || operationHasChildChanges(o)
  );
  const attributes = (diff?.attributes ?? []).filter(
    (a) => a.status !== "unchanged"
  );

  const isEmpty =
    materials.length === 0 &&
    operations.length === 0 &&
    attributes.length === 0;

  return (
    <div className="w-full rounded-lg border border-border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground pb-2">
        <Trans>Changes</Trans>
      </div>
      {isEmpty ? (
        <span className="text-sm text-muted-foreground italic">
          <Trans>No changes yet.</Trans>
        </span>
      ) : (
        <VStack spacing={8} className="w-full">
          {materials.length > 0 && (
            <Section title={<Trans>Bill of Materials</Trans>}>
              {materials.map((m, i) => (
                <MaterialEntry key={`mat-${i}`} entry={m} items={items} />
              ))}
            </Section>
          )}
          {operations.length > 0 && (
            <Section title={<Trans>Bill of Process</Trans>}>
              {operations.map((o, i) => (
                <OperationEntry key={`op-${i}`} entry={o} />
              ))}
            </Section>
          )}
          {attributes.length > 0 && (
            <Section title={<Trans>Attributes</Trans>}>
              {attributes.map((a, i) => (
                <VStack key={`attr-${i}`} spacing={1} className="w-full">
                  {modifiedFieldRows(a)}
                </VStack>
              ))}
            </Section>
          )}
        </VStack>
      )}
    </div>
  );
}
