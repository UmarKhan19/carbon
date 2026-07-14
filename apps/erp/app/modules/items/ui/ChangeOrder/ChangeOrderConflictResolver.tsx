import {
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useItems } from "~/stores";
import type {
  ChangeOrderMergeChoice,
  ChangeOrderReleaseConflict,
  ChangeOrderReleaseConflictEntry
} from "../../changeOrder.models";
import { changeOrderMergeEntryKey } from "../../changeOrder.models";
import { DiffBadge } from "./diff-ui";

type Items = ReturnType<typeof useItems>[0];
type Row = Record<string, unknown>;

// Fields shown for context under a line's title, in addition to whatever the
// diff flagged as changed. The title itself (component for materials, description
// for operations) is rendered separately and excluded from the body list.
const MATERIAL_PRIMARY = ["quantity", "unitOfMeasureCode"];
const OPERATION_PRIMARY = ["order"];
const TITLE_FIELD = { material: "itemId", operation: "description" } as const;

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
  workInstruction: "Work instructions"
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

function lineTitle(
  entry: ChangeOrderReleaseConflictEntry,
  row: Row | null,
  items: Items
): string {
  if (entry.kind === "material") {
    const itemId = (row?.itemId as string | undefined) ?? entry.itemId ?? "";
    return getItemReadableId(items, itemId) || itemId || "Material";
  }
  const description = row?.description as string | undefined;
  const order = row?.order as number | string | undefined;
  return description || `Operation ${order ?? ""}`.trim();
}

// The set of body fields to render for a line: primary context fields + any the
// diff flagged as changed, minus the title field (shown in the row header).
function bodyFields(entry: ChangeOrderReleaseConflictEntry): string[] {
  const keys = new Set<string>(
    entry.kind === "material" ? MATERIAL_PRIMARY : OPERATION_PRIMARY
  );
  for (const k of Object.keys(entry.changedFields ?? {})) keys.add(k);
  keys.delete(TITLE_FIELD[entry.kind]);
  return [...keys];
}

// One version of one line — the left ("mine") or right ("theirs") half of a
// paired conflict block. Always selectable: picking a side whose row is absent
// means dropping (mine-absent) or not adopting (theirs-absent) the line.
function SideCard({
  entry,
  row,
  selected,
  changedFields,
  ghostLabel,
  onSelect
}: {
  entry: ChangeOrderReleaseConflictEntry;
  row: Row | null;
  selected: boolean;
  changedFields: Set<string>;
  ghostLabel: ReactNode;
  onSelect: () => void;
}) {
  const [items] = useItems();
  const fields = bodyFields(entry);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full flex-col gap-1.5 rounded-lg border p-3 pl-8 text-left transition-colors",
        selected
          ? "border-foreground/30 bg-muted/50"
          : "border-border hover:bg-muted/30"
      )}
    >
      {/* Radio — outer ring with a filled center dot when selected. */}
      <span
        className={cn(
          "absolute left-3 top-3.5 flex size-3.5 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-foreground"
            : "border-border group-hover:border-foreground/40"
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-foreground" />}
      </span>

      {row ? (
        <>
          <span
            className={cn(
              "text-sm",
              selected ? "text-foreground" : "text-foreground/70"
            )}
          >
            {lineTitle(entry, row, items)}
          </span>
          <dl className="flex flex-col gap-0.5">
            {fields.map((field) => {
              const isChanged = changedFields.has(field);
              return (
                <div
                  key={field}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="text-xs text-muted-foreground">
                    {humanizeField(field)}
                  </dt>
                  <dd
                    className={cn(
                      "text-right text-xs tabular-nums",
                      isChanged
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatValue(field, row[field])}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <span className="flex min-h-12 items-center text-xs italic text-muted-foreground">
          {ghostLabel}
        </span>
      )}
    </button>
  );
}

function ConflictBlock({
  entry,
  choice,
  onChoice
}: {
  entry: ChangeOrderReleaseConflictEntry;
  choice: ChangeOrderMergeChoice;
  onChoice: (choice: ChangeOrderMergeChoice) => void;
}) {
  const { t } = useLingui();
  const changed = new Set(Object.keys(entry.changedFields ?? {}));
  const cc = entry.childChanges;
  const childNote =
    cc && cc.steps + cc.parameters + cc.tools > 0
      ? [
          cc.steps ? t`${cc.steps} steps` : null,
          cc.parameters ? t`${cc.parameters} parameters` : null,
          cc.tools ? t`${cc.tools} tools` : null
        ]
          .filter(Boolean)
          .join(", ")
      : null;

  return (
    <VStack spacing={1} className="w-full">
      <HStack spacing={2}>
        <DiffBadge status={entry.status} />
        {childNote && (
          <span className="text-xs text-muted-foreground">
            <Trans>sub-steps differ ({childNote}), kept with your pick</Trans>
          </span>
        )}
      </HStack>
      <div className="grid w-full grid-cols-2 gap-2">
        <SideCard
          entry={entry}
          row={entry.mine}
          selected={choice === "mine"}
          changedFields={changed}
          ghostLabel={<Trans>Removed in your version</Trans>}
          onSelect={() => onChoice("mine")}
        />
        <SideCard
          entry={entry}
          row={entry.theirs}
          selected={choice === "theirs"}
          changedFields={changed}
          ghostLabel={<Trans>Not in the latest version</Trans>}
          onSelect={() => onChoice("theirs")}
        />
      </div>
    </VStack>
  );
}

function Section({
  title,
  entries,
  choices,
  onChoice
}: {
  title: ReactNode;
  entries: ChangeOrderReleaseConflictEntry[];
  choices: Record<string, ChangeOrderMergeChoice>;
  onChoice: (entryKey: string, choice: ChangeOrderMergeChoice) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <VStack spacing={2} className="w-full">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {entries.map((entry) => {
        const key = changeOrderMergeEntryKey(entry);
        return (
          <ConflictBlock
            key={key}
            entry={entry}
            choice={choices[key] ?? entry.defaultChoice}
            onChoice={(choice) => onChoice(key, choice)}
          />
        );
      })}
    </VStack>
  );
}

// Full-screen, one-part-at-a-time git-style merge resolver. Left column is this
// change order's draft ("Your version"), right is the current live method
// ("Latest released"). The caller owns the choice map (keyed by the line's
// changeOrderMergeEntryKey) so picks survive close/reopen; `onDone` marks the
// part resolved.
export default function ChangeOrderConflictResolver({
  open,
  partLabel,
  conflict,
  choices,
  onChoice,
  onSetAll,
  onDone,
  onClose
}: {
  open: boolean;
  partLabel: string;
  conflict: ChangeOrderReleaseConflict;
  choices: Record<string, ChangeOrderMergeChoice>;
  onChoice: (entryKey: string, choice: ChangeOrderMergeChoice) => void;
  onSetAll: (choice: ChangeOrderMergeChoice) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const materials = conflict.entries.filter((e) => e.kind === "material");
  const operations = conflict.entries.filter((e) => e.kind === "operation");
  const total = conflict.entries.length;
  const keptMine = conflict.entries.filter(
    (e) => (choices[changeOrderMergeEntryKey(e)] ?? e.defaultChoice) === "mine"
  ).length;

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent
        withCloseButton={false}
        className="flex h-[92vh] w-[92vw] max-w-5xl flex-col p-0 pt-0"
      >
        <ModalHeader className="mb-0 gap-1 border-b border-border px-6 py-4">
          <ModalTitle className="font-normal">
            <Trans>Resolve conflicts</Trans>
            <span className="text-muted-foreground"> · {partLabel}</span>
          </ModalTitle>
          <span className="text-xs text-muted-foreground">
            <Trans>
              A newer version of this part was released while you were working.
              Choose which version to keep for each change.
            </Trans>
          </span>
        </ModalHeader>

        {/* Column headers + bulk actions + progress */}
        <div className="flex flex-col gap-2 border-b border-border px-6 py-2">
          <HStack className="w-full justify-between">
            <span className="text-xs tabular-nums text-muted-foreground">
              <Trans>
                Keeping {keptMine} of {total} from your version
              </Trans>
            </span>
            <HStack spacing={2}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onSetAll("mine")}
              >
                <Trans>Take all mine</Trans>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onSetAll("theirs")}
              >
                <Trans>Take all latest</Trans>
              </Button>
            </HStack>
          </HStack>
          <div className="grid grid-cols-2 gap-2">
            <span className="px-1 text-xs font-medium text-foreground">
              <Trans>Your version</Trans>
            </span>
            <span className="px-1 text-xs font-medium text-foreground">
              <Trans>Latest released</Trans>
            </span>
          </div>
        </div>

        <ModalBody className="mb-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent py-4">
          <VStack spacing={4}>
            <Section
              title={<Trans>Materials</Trans>}
              entries={materials}
              choices={choices}
              onChoice={onChoice}
            />
            <Section
              title={<Trans>Operations</Trans>}
              entries={operations}
              choices={choices}
              onChoice={onChoice}
            />
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            {t`Cancel`}
          </Button>
          <Button variant="primary" onClick={onDone}>
            {t`Done`}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
