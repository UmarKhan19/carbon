import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import type { AssemblyGraphIndex, PartGroup } from "@carbon/viewer";
import { describeStep } from "@carbon/viewer";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowDownAZ,
  LuArrowDownWideNarrow,
  LuBlocks,
  LuChevronDown,
  LuChevronRight,
  LuEye,
  LuEyeOff,
  LuMerge,
  LuSearch,
  LuSettings,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { FlattenedBomMaterial } from "../../production.service";
import { toViewerStep } from "../../production.service";
import type {
  AssemblyInstructionStepRow,
  AssemblyPartMapping,
  AssemblyUnit
} from "../../types";
import { PartColorSwatch } from "./AssemblyStepBom";

type SortMode = "count" | "alpha";

/** One rendered row: a part group, or a single instance of an expanded group. */
type ListRow =
  | { type: "group"; group: PartGroup }
  | {
      type: "instance";
      group: PartGroup;
      nodeId: string;
      instanceIndex: number;
    };

/** The instance nodeIds a row represents (all of them for a group row). */
function rowNodeIds(row: ListRow): string[] {
  return row.type === "group" ? row.group.nodeIds : [row.nodeId];
}

type SelectionState = "none" | "partial" | "all";

function selectionStateOf(
  nodeIds: string[],
  selected: ReadonlySet<string>
): SelectionState {
  let count = 0;
  for (const id of nodeIds) if (selected.has(id)) count++;
  if (count === 0) return "none";
  return count === nodeIds.length ? "all" : "partial";
}

type AssemblyBomTreeProps = {
  graphIndex: AssemblyGraphIndex | null;
  steps: AssemblyInstructionStepRow[];
  units: AssemblyUnit[];
  isDisabled: boolean;
  modelUploadId: string | null;
  partMappings: AssemblyPartMapping[];
  bomMaterials: FlattenedBomMaterial[];
  /** Current selection (shared with the viewer) — marks + scrolls to the rows */
  selectedNodeIds: string[];
  /** The Parts tab is the visible tab — gate scroll-to-selection on it */
  isActive: boolean;
  onHighlightParts: (nodeIds: string[]) => void;
  onHideParts: (nodeIds: string[]) => void;
  onSelectStep: (stepId: string) => void;
};

/**
 * Bill of materials derived from the model's assembly graph: every distinct
 * part with its instance count, plus authored subassembly units — sets of parts
 * the planner treats as one rigid body (overriding the automatic BOM-driven
 * derivation). Selecting rows highlights all instances in the viewer; a
 * selection can be planned as one part via the toolbar or right-click menu.
 * Parts map to engineering BOM items (methodMaterial) by geometry hash —
 * auto-matched by name/quantity, adjustable per part in the detail popover.
 */
export default function AssemblyBomTree({
  graphIndex,
  steps,
  units,
  isDisabled,
  modelUploadId,
  partMappings,
  bomMaterials,
  selectedNodeIds,
  isActive,
  onHighlightParts,
  onHideParts,
  onSelectStep
}: AssemblyBomTreeProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const canGroup = !isDisabled && permissions.can("create", "production");
  const canMap =
    !isDisabled &&
    permissions.can("update", "production") &&
    Boolean(modelUploadId);

  const autoMatchFetcher = useFetcher<{ success: boolean }>();
  const mappingsByHash = useMemo(
    () =>
      new Map(partMappings.map((mapping) => [mapping.geometryHash, mapping])),
    [partMappings]
  );

  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [search, setSearch] = useState("");
  // Selection and visibility are tracked per instance (nodeId), so a group with
  // several instances can be partly selected or hidden — e.g. 2 of 4 screws.
  // Selection round-trips through the parent (shared with the viewer).
  const selectedSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds]
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [showCreateUnit, setShowCreateUnit] = useState(false);
  const lastClickedIndexRef = useRef<number | null>(null);

  const partGroups = useMemo(() => {
    if (!graphIndex) return [];
    const sorted = [...graphIndex.groups];
    if (sortMode === "count") {
      sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [graphIndex, sortMode]);

  // Name filter for the rendered list. Selection/hiding still operate on the
  // full `partGroups` (they key by group, not display position); only the rows
  // shown, the shift-click range, and scroll-to-selection use `rows`.
  const normalizedSearch = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!normalizedSearch) return partGroups;
    return partGroups.filter((group) =>
      group.name.toLowerCase().includes(normalizedSearch)
    );
  }, [partGroups, normalizedSearch]);

  /** groupKey → steps that install instances of the part */
  const stepUsage = useMemo(() => {
    const usage = new Map<
      string,
      { stepId: string; index: number; title: string }[]
    >();
    if (!graphIndex) return usage;
    steps.forEach((step, index) => {
      const seen = new Set<string>();
      for (const nodeId of step.partNodeIds ?? []) {
        const group = graphIndex.groupByNodeId.get(nodeId);
        if (!group || seen.has(group.key)) continue;
        seen.add(group.key);
        const entry = usage.get(group.key) ?? [];
        entry.push({
          stepId: step.id,
          index,
          title: describeStep(toViewerStep(step), graphIndex) ?? "Untitled step"
        });
        usage.set(group.key, entry);
      }
    });
    return usage;
  }, [steps, graphIndex]);

  // Flatten groups (with their expanded instances) into the virtualized list.
  // An expanded group with count > 1 is followed by one row per instance, so a
  // subset can be selected or hidden individually.
  const visualRows = useMemo<ListRow[]>(() => {
    const list: ListRow[] = [];
    for (const group of rows) {
      list.push({ type: "group", group });
      if (group.count > 1 && expandedKeys.has(group.key)) {
        group.nodeIds.forEach((nodeId, instanceIndex) => {
          list.push({ type: "instance", group, nodeId, instanceIndex });
        });
      }
    }
    return list;
  }, [rows, expandedKeys]);

  const hasSelection = selectedNodeIds.length > 0;

  // Push the hidden instance set up to the viewer.
  useEffect(() => {
    onHideParts([...hiddenNodeIds]);
  }, [hiddenNodeIds, onHideParts]);

  const applyNodeSelection = (next: ReadonlySet<string>) => {
    setSelectedUnitId(null);
    onHighlightParts([...next]);
  };

  const onRowClick = (event: MouseEvent, rowIndex: number) => {
    const row = visualRows[rowIndex];
    if (!row) return;
    const rowNodes = rowNodeIds(row);
    let next: Set<string>;
    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      next = new Set(selectedNodeIds);
      const start = Math.min(lastClickedIndexRef.current, rowIndex);
      const end = Math.max(lastClickedIndexRef.current, rowIndex);
      for (let i = start; i <= end; i++) {
        const inRange = visualRows[i];
        if (inRange) for (const id of rowNodeIds(inRange)) next.add(id);
      }
    } else if (event.metaKey || event.ctrlKey) {
      next = new Set(selectedNodeIds);
      const allSelected = rowNodes.every((id) => next.has(id));
      for (const id of rowNodes) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
    } else {
      // Plain click selects just this row; clicking it when it is already the
      // entire selection clears it.
      const isOnlySelection =
        selectedNodeIds.length === rowNodes.length &&
        rowNodes.every((id) => selectedSet.has(id));
      next = isOnlySelection ? new Set() : new Set(rowNodes);
    }
    lastClickedIndexRef.current = rowIndex;
    applyNodeSelection(next);
  };

  const onToggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onToggleUnitHighlight = (unit: AssemblyUnit) => {
    if (selectedUnitId === unit.id) {
      setSelectedUnitId(null);
      onHighlightParts([]);
      return;
    }
    setSelectedUnitId(unit.id);
    onHighlightParts(unit.partNodeIds ?? []);
  };

  const onHideSelection = () => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedNodeIds) next.add(id);
      return next;
    });
    applyNodeSelection(new Set());
  };

  // Toggle visibility of a set of instances (a whole group, or one instance).
  // A group hides unless every instance is already hidden, in which case it
  // reveals them (Onshape-style per-row eye).
  const onToggleHide = (nodeIds: string[]) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      const allHidden = nodeIds.every((id) => next.has(id));
      for (const id of nodeIds) {
        if (allHidden) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const onShowAll = () => setHiddenNodeIds(new Set());

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visualRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12
  });

  // Bring the current selection into view — when it changes while the Parts tab
  // is open, and when the tab becomes active with a selection already present.
  // The scroll container has no dimensions while the tab is hidden, so gate on
  // isActive and defer a frame so the just-shown list can measure.
  const firstSelectedIndex = useMemo(
    () =>
      visualRows.findIndex((row) =>
        rowNodeIds(row).some((id) => selectedSet.has(id))
      ),
    [visualRows, selectedSet]
  );
  useEffect(() => {
    if (!isActive || firstSelectedIndex < 0) return;
    const frame = requestAnimationFrame(() =>
      virtualizer.scrollToIndex(firstSelectedIndex, { align: "center" })
    );
    return () => cancelAnimationFrame(frame);
  }, [isActive, firstSelectedIndex, virtualizer]);

  if (!graphIndex) {
    return (
      <Empty className="border-none">
        <p className="text-sm text-muted-foreground max-w-[280px] text-center">
          The bill of materials appears here once the model loads
        </p>
      </Empty>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {units.length > 0 && (
        <div className="w-full flex-none border-b border-border">
          <h4 className="px-3 pt-2 text-xxs text-foreground/70 uppercase font-light tracking-wide">
            Subassemblies
          </h4>
          <ul className="w-full pb-1">
            {units.map((unit) => (
              <UnitRow
                key={unit.id}
                unit={unit}
                instructionId={id}
                isSelected={selectedUnitId === unit.id}
                isDisabled={isDisabled}
                onClick={() => onToggleUnitHighlight(unit)}
              />
            ))}
          </ul>
        </div>
      )}
      <div className="flex w-full flex-none items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          {hasSelection
            ? `${selectedNodeIds.length} selected`
            : bomMaterials.length > 0
              ? `${partGroups.length} parts · ${mappingsByHash.size} mapped to BOM`
              : `${partGroups.length} part${partGroups.length === 1 ? "" : "s"} · ${graphIndex.graph.partCount} instance${graphIndex.graph.partCount === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-1">
          {!hasSelection && canMap && bomMaterials.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={autoMatchFetcher.state !== "idle"}
                  isLoading={autoMatchFetcher.state !== "idle"}
                  onClick={() => {
                    autoMatchFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.autoMatchAssemblyParts(id)
                    });
                  }}
                >
                  Match BOM
                </Button>
              </TooltipTrigger>
              <TooltipContent>Match parts to BOM items</TooltipContent>
            </Tooltip>
          )}
          {hasSelection && canGroup && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Plan as one part"
                  icon={<LuMerge />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateUnit(true)}
                />
              </TooltipTrigger>
              <TooltipContent>Plan as one part</TooltipContent>
            </Tooltip>
          )}
          {hasSelection && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Hide selected parts"
                  icon={<LuEyeOff />}
                  variant="ghost"
                  size="sm"
                  onClick={onHideSelection}
                />
              </TooltipTrigger>
              <TooltipContent>Hide selected parts</TooltipContent>
            </Tooltip>
          )}
          {hiddenNodeIds.size > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label="Show all hidden parts"
                  icon={<LuEye />}
                  variant="ghost"
                  size="sm"
                  onClick={onShowAll}
                />
              </TooltipTrigger>
              <TooltipContent>Show all hidden parts</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                aria-label={
                  sortMode === "count" ? "Sort alphabetically" : "Sort by count"
                }
                icon={
                  sortMode === "count" ? (
                    <LuArrowDownWideNarrow />
                  ) : (
                    <LuArrowDownAZ />
                  )
                }
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSortMode((mode) => (mode === "count" ? "alpha" : "count"))
                }
              />
            </TooltipTrigger>
            <TooltipContent>
              {sortMode === "count" ? "Sort alphabetically" : "Sort by count"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {partGroups.length > 0 && (
        <div className="relative w-full flex-none border-b border-border px-2 py-1.5">
          <LuSearch className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search parts"
            placeholder="Search parts"
            size="sm"
            className="pl-7"
            value={search}
            onChange={(searchEvent) => setSearch(searchEvent.target.value)}
          />
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={parentRef}
            className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
            onKeyDown={(event) => {
              if (event.key === "Escape" && hasSelection) {
                applyNodeSelection(new Set());
              }
            }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = visualRows[virtualRow.index];
                if (!row) return null;
                const style: React.CSSProperties = {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`
                };
                const nodes = rowNodeIds(row);
                if (row.type === "instance") {
                  return (
                    <InstanceRow
                      key={row.nodeId}
                      group={row.group}
                      instanceIndex={row.instanceIndex}
                      isSelected={selectedSet.has(row.nodeId)}
                      isHidden={hiddenNodeIds.has(row.nodeId)}
                      style={style}
                      onClick={(event) => onRowClick(event, virtualRow.index)}
                      onToggleHide={() => onToggleHide(nodes)}
                    />
                  );
                }
                const group = row.group;
                return (
                  <BomRow
                    key={group.key}
                    group={group}
                    selection={selectionStateOf(nodes, selectedSet)}
                    hidden={selectionStateOf(nodes, hiddenNodeIds)}
                    isExpanded={expandedKeys.has(group.key)}
                    usage={stepUsage.get(group.key) ?? []}
                    mapping={mappingsByHash.get(group.key) ?? null}
                    bomMaterials={bomMaterials}
                    canMap={canMap}
                    modelUploadId={modelUploadId}
                    instructionId={id}
                    style={style}
                    onClick={(event) => onRowClick(event, virtualRow.index)}
                    onToggleHide={() => onToggleHide(nodes)}
                    onToggleExpand={() => onToggleExpand(group.key)}
                    onSelectStep={onSelectStep}
                  />
                );
              })}
            </div>
            {rows.length === 0 && normalizedSearch && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No parts match “{search.trim()}”
              </p>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!canGroup || !hasSelection}
            onClick={() => setShowCreateUnit(true)}
          >
            <LuMerge className="mr-2 h-4 w-4" />
            Plan as one part
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!hasSelection} onClick={onHideSelection}>
            <LuEyeOff className="mr-2 h-4 w-4" />
            Hide selected parts
          </ContextMenuItem>
          <ContextMenuItem
            disabled={hiddenNodeIds.size === 0}
            onClick={onShowAll}
          >
            <LuEye className="mr-2 h-4 w-4" />
            Show all hidden parts
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasSelection}
            onClick={() => applyNodeSelection(new Set())}
          >
            Clear selection
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {showCreateUnit && modelUploadId && (
        <CreateUnitModal
          instructionId={id}
          modelUploadId={modelUploadId}
          partNodeIds={selectedNodeIds}
          onClose={() => setShowCreateUnit(false)}
          onCreated={() => {
            setShowCreateUnit(false);
            applyNodeSelection(new Set());
          }}
        />
      )}
    </div>
  );
}

function UnitRow({
  unit,
  instructionId,
  isSelected,
  isDisabled,
  onClick
}: {
  unit: AssemblyUnit;
  instructionId: string;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  const permissions = usePermissions();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  if (deleteFetcher.state !== "idle") return null;

  return (
    <li
      className={cn(
        "group flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1 text-sm hover:bg-accent/30",
        isSelected && "bg-accent/50 hover:bg-accent/50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter") onClick();
      }}
    >
      <LuBlocks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate" title={unit.name}>
        {unit.name}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {unit.partNodeIds?.length ?? 0}
      </span>
      {!isDisabled && permissions.can("delete", "production") && (
        <IconButton
          aria-label={`Delete subassembly ${unit.name}`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            deleteFetcher.submit(new FormData(), {
              method: "post",
              action: path.to.deleteAssemblyUnit(instructionId, unit.id)
            });
          }}
        />
      )}
    </li>
  );
}

function CreateUnitModal({
  instructionId,
  modelUploadId,
  partNodeIds,
  onClose,
  onCreated
}: {
  instructionId: string;
  modelUploadId: string;
  partNodeIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [name, setName] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      onCreated();
    }
  }, [fetcher.state, fetcher.data, onCreated]);

  const onSubmit = () => {
    if (!name.trim()) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("name", name.trim());
    formData.append("partNodeIds", JSON.stringify(partNodeIds));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyUnit(instructionId)
    });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Plan as one part</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} className="w-full">
            <p className="text-sm text-muted-foreground">
              The planner treats these {partNodeIds.length} part
              {partNodeIds.length === 1 ? "" : "s"} as one rigid body — one step
              in the instructions. Re-run the plan to apply.
            </p>
            <Input
              aria-label="Subassembly name"
              placeholder="Subassembly name"
              value={name}
              autoFocus
              onChange={(nameEvent) => setName(nameEvent.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
            />
            <Button
              className="self-end"
              isDisabled={!name.trim() || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
              onClick={onSubmit}
            >
              Create
            </Button>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function BomRow({
  group,
  selection,
  hidden,
  isExpanded,
  usage,
  mapping,
  bomMaterials,
  canMap,
  modelUploadId,
  instructionId,
  style,
  onClick,
  onToggleHide,
  onToggleExpand,
  onSelectStep
}: {
  group: PartGroup;
  selection: SelectionState;
  hidden: SelectionState;
  isExpanded: boolean;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyPartMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
  onToggleExpand: () => void;
  onSelectStep: (stepId: string) => void;
}) {
  const bomLine = mapping
    ? bomMaterials.find((material) => material.itemId === mapping.itemId)
    : undefined;
  const quantityMismatch =
    bomLine !== undefined && Math.round(bomLine.quantity) !== group.count;
  const allHidden = hidden === "all";
  const expandable = group.count > 1;

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border px-3 text-sm hover:bg-accent/30",
        // Selection is red everywhere (matches the viewer highlight): a left bar
        // plus a red wash. A partly-selected group reads lighter than a full one.
        selection === "all" && "bg-red-500/10 hover:bg-red-500/10",
        selection === "partial" && "bg-red-500/5 hover:bg-red-500/5",
        allHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {selection !== "none" && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-red-500",
            selection === "partial" && "opacity-50"
          )}
        />
      )}
      {expandable ? (
        <button
          type="button"
          aria-label={
            isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`
          }
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? (
            <LuChevronDown className="h-3.5 w-3.5" />
          ) : (
            <LuChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden />
      )}
      <PartColorSwatch color={group.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={group.name}>
          {group.name}
        </span>
        {mapping?.item && (
          <span
            className={cn(
              "truncate text-xs",
              // Mismatch stands out via full-strength text + the explicit "≠"
              // clause below — no colored status text (see .ai/ds-rules.md)
              quantityMismatch ? "text-foreground" : "text-muted-foreground"
            )}
            title={mapping.item.name ?? undefined}
          >
            {mapping.item.readableIdWithRevision}
            {quantityMismatch &&
              bomLine &&
              ` · BOM qty ${Math.round(bomLine.quantity)} ≠ model ${group.count}`}
          </span>
        )}
      </div>
      <Badge variant="secondary" className="tabular-nums">
        ×{group.count}
      </Badge>
      {/* Ghost icon buttons sit flush together (no gap between them) */}
      <div className="flex items-center">
        <IconButton
          aria-label={allHidden ? `Show ${group.name}` : `Hide ${group.name}`}
          icon={allHidden ? <LuEyeOff /> : <LuEye />}
          variant="ghost"
          size="sm"
          className={cn(
            "focus:opacity-100",
            // A group with any hidden instance keeps the eye visible as its
            // status + control; fully-visible groups reveal it on hover.
            hidden !== "none"
              ? "opacity-100 text-muted-foreground"
              : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHide();
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              aria-label={`Part details: ${group.name}`}
              icon={<LuSettings />}
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
            />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 text-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <PartDetails
              group={group}
              usage={usage}
              mapping={mapping}
              bomMaterials={bomMaterials}
              canMap={canMap}
              modelUploadId={modelUploadId}
              instructionId={instructionId}
              onSelectStep={onSelectStep}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** A single instance of an expanded group — selectable and hideable on its own. */
function InstanceRow({
  group,
  instanceIndex,
  isSelected,
  isHidden,
  style,
  onClick,
  onToggleHide
}: {
  group: PartGroup;
  instanceIndex: number;
  isSelected: boolean;
  isHidden: boolean;
  style: React.CSSProperties;
  onClick: (event: MouseEvent) => void;
  onToggleHide: () => void;
}) {
  const label = `${group.name} #${instanceIndex + 1}`;
  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={cn(
        "group relative flex cursor-pointer select-none items-center gap-2 border-b border-border py-1 pl-9 pr-3 text-sm hover:bg-accent/30",
        isSelected && "bg-red-500/10 hover:bg-red-500/10",
        isHidden && "opacity-50"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event as unknown as MouseEvent);
        }
      }}
    >
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-red-500"
        />
      )}
      <PartColorSwatch color={group.color} />
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={label}
      >
        {group.name}{" "}
        <span className="tabular-nums text-foreground">
          #{instanceIndex + 1}
        </span>
      </span>
      <IconButton
        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
        icon={isHidden ? <LuEyeOff /> : <LuEye />}
        variant="ghost"
        size="sm"
        className={cn(
          "focus:opacity-100",
          isHidden
            ? "opacity-100 text-muted-foreground"
            : "opacity-0 group-hover:opacity-100"
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleHide();
        }}
      />
    </div>
  );
}

function PartDetails({
  group,
  usage,
  mapping,
  bomMaterials,
  canMap,
  modelUploadId,
  instructionId,
  onSelectStep
}: {
  group: PartGroup;
  usage: { stepId: string; index: number; title: string }[];
  mapping: AssemblyPartMapping | null;
  bomMaterials: FlattenedBomMaterial[];
  canMap: boolean;
  modelUploadId: string | null;
  instructionId: string;
  onSelectStep: (stepId: string) => void;
}) {
  const mapFetcher = useFetcher<{ success: boolean }>();
  const size = [
    group.bbox.max[0] - group.bbox.min[0],
    group.bbox.max[1] - group.bbox.min[1],
    group.bbox.max[2] - group.bbox.min[2]
  ];

  const onMap = (itemId: string) => {
    if (!modelUploadId) return;
    const formData = new FormData();
    formData.append("modelUploadId", modelUploadId);
    formData.append("geometryHash", group.key);
    formData.append("itemId", itemId);
    mapFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyPartMapping(instructionId)
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <PartColorSwatch color={group.color} />
        <p className="min-w-0 flex-1 truncate font-medium" title={group.name}>
          {group.name}
        </p>
        <Badge variant="secondary" className="tabular-nums">
          ×{group.count}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">
          {size.map((dim) => formatLength(dim)).join(" × ")} mm
        </dd>
        <dt className="text-muted-foreground">Volume</dt>
        <dd className="tabular-nums">{formatVolume(group.volume)}</dd>
      </dl>
      {bomMaterials.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Bill of materials</p>
          {mapping?.item ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {mapping.item.readableIdWithRevision} · {mapping.item.name}
              </span>
              {canMap && (
                <IconButton
                  aria-label="Remove BOM mapping"
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  isDisabled={mapFetcher.state !== "idle"}
                  onClick={() => {
                    mapFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.deleteAssemblyPartMapping(
                        instructionId,
                        mapping.id
                      )
                    });
                  }}
                />
              )}
            </div>
          ) : canMap ? (
            <ul className="flex max-h-36 flex-col overflow-y-auto">
              {bomMaterials.map((material) => (
                <li key={`${material.itemId}-${material.depth}`}>
                  <button
                    type="button"
                    className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    disabled={mapFetcher.state !== "idle"}
                    title={material.name ?? undefined}
                    onClick={() => onMap(material.itemId)}
                  >
                    <span className="text-muted-foreground tabular-nums mr-1">
                      ×{Math.round(material.quantity)}
                    </span>
                    {material.readableIdWithRevision} · {material.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Not mapped</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Used in steps</p>
        {usage.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Not referenced by any step
          </p>
        ) : (
          <ul className="flex flex-col">
            {usage.map((entry) => (
              <li key={entry.stepId}>
                <button
                  type="button"
                  className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent"
                  title={entry.title}
                  onClick={() => onSelectStep(entry.stepId)}
                >
                  <span className="text-muted-foreground tabular-nums mr-1">
                    {entry.index + 1}.
                  </span>
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatLength(mm: number): string {
  return mm >= 100 ? mm.toFixed(0) : mm.toFixed(1);
}

function formatVolume(mm3: number | null): string {
  if (mm3 === null) return "—";
  if (mm3 >= 1000) return `${(mm3 / 1000).toFixed(1)} cm³`;
  return `${mm3.toFixed(0)} mm³`;
}
