import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  Button,
  cn,
  generateHTML,
  ModelViewer,
  Separator,
  SidebarTrigger,
  Status,
  TruncatedTooltipText,
  useDisclosure,
  useKeyboardWedge,
  useMode,
  useRealtimeChannel,
  useRouteData
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { useEffect, useState } from "react";
import {
  LuBarcode,
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuEllipsisVertical,
  LuExpand,
  LuFlag,
  LuGitBranchPlus,
  LuGitPullRequest,
  LuHammer,
  LuHardHat,
  LuImage,
  LuPause,
  LuPlay,
  LuPrinter,
  LuQrCode,
  LuSkipForward,
  LuTimer,
  LuTrash,
  LuUndo2,
  LuWrench
} from "react-icons/lu";
import {
  useFetcher,
  useNavigate,
  useRevalidator,
  useSearchParams
} from "react-router";
import { OperationChat } from "~/components/JobOperation/components/Chat";
import { IssueMaterialModal } from "~/components/JobOperation/components/IssueMaterialModal";
import { MaintenanceDispatch } from "~/components/JobOperation/components/MaintenanceDispatch";
import { QualityIssueModal } from "~/components/JobOperation/components/QualityIssueModal";
import { QuantityModal } from "~/components/JobOperation/components/QuantityModal";
import { ReworkModal } from "~/components/JobOperation/components/ReworkModal";
import { SerialSelectorModal } from "~/components/JobOperation/components/SerialSelectorModal";
import { RecordModal } from "~/components/JobOperation/components/Step";
import { ImageZoomViewer } from "~/components/ImageZoomViewer";
import { useUser } from "~/hooks";
import type {
  JobMaterial,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent as ProductionEventType
} from "~/services/types";
import { getPrivateUrl, path } from "~/utils/path";
import { deriveUnits } from "~/utils/units";

type StepRecord = {
  id: string;
  index: number;
  value?: string | null;
  numericValue?: number | null;
  booleanValue?: boolean | null;
  userValue?: string | null;
  createdBy?: string | null;
};

type Slide = {
  id: string;
  imagePath: string;
  caption?: string | null;
  sortOrder?: number | null;
};

type Step = {
  id: string;
  name?: string | null;
  description?: unknown;
  type?: string | null;
  sortOrder?: number | null;
  unitOfMeasureCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  listValues?: string[] | null;
  jobOperationStepRecord?: StepRecord[];
  jobOperationStepSlide?: Slide[];
};

type ProductionEvent = {
  id: string;
  type?: string | null;
  startTime: string;
  endTime?: string | null;
  duration?: number | null;
  employeeId?: string | null;
};

type ContainmentAction = {
  id: string;
  actionTypeName: string;
  nonConformanceId: string;
  notes: unknown;
};

type Operation = {
  id: string;
  description?: string | null;
  workCenterId?: string | null;
  operationQuantity?: number | null;
  quantityComplete?: number | null;
  laborDuration?: number | null;
  setupDuration?: number | null;
  machineDuration?: number | null;
  itemDescription?: string | null;
  itemReadableId?: string | null;
  jobReadableId?: string | null;
  operationStatus?: string | null;
  jobStatus?: string | null;
  duration?: number | null;
  jobDeadlineType?: string | null;
};

type Props = {
  operationId: string;
  job: { itemReadableIdWithRevision?: string | null } | null;
  operation: Operation | null;
  thumbnailPath: string | null | undefined;
  trackedEntities: {
    id: string;
    readableId?: string | null;
    status?: string | null;
  }[];
  trackedEntityId: string | null;
  materials: { materials?: any[]; trackedInputs?: any[] } | null;
  procedure: { attributes: Step[]; parameters: any[] };
  tools: {
    quantity: number;
    item: { id: string; name: string; type: string } | null;
  }[];
  ncrs: any[];
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
  openEvent: { id: string; startTime: string } | null;
  events: ProductionEvent[];
  nonConformanceActions: ContainmentAction[];
  expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  productionQuantities?: { scrap: number; production: number; rework: number };
  workCenter?: {
    id: string;
    name: string;
    isBlocked: boolean | null;
    blockingDispatchId: string | null;
    blockingDispatchReadableId: string | null;
  } | null;
  kanban?: { id?: string; completedBarcodeOverride?: string | null } | null;
  jobId?: string | null;
  modelPath?: string | null;
};

// Real Carbon item types, in display order. Fasteners is NOT a Carbon concept.
const TYPE_ORDER = [
  "Part",
  "Material",
  "Consumable",
  "Fixture",
  "Tool",
  "Service"
];
const pluralize = (type: string) =>
  !type ? "Items" : type.endsWith("s") ? type : `${type}s`;

// Increasing bar heights for the unit-progress "signal" flourish in the header.
const SIGNAL_HEIGHTS = [
  "h-1.5",
  "h-2",
  "h-2.5",
  "h-3",
  "h-3.5",
  "h-4",
  "h-[18px]"
];

// Walk a TipTap/ProseMirror doc and collect text (incl. @mention labels).
function richTextToPlainText(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") parts.push(node.text);
    else if (node.type === "mention" && node.attrs?.label)
      parts.push(node.attrs.label);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Strip any inline image nodes so the prose shows text only — reference imagery
// now lives in first-class slides, not embedded in the description.
function stripImages(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  if (Array.isArray(doc.content)) {
    return {
      ...doc,
      content: doc.content
        .filter((n: any) => n?.type !== "image")
        .map(stripImages)
    };
  }
  return doc;
}

function formatElapsed(s: number) {
  const h = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// Live elapsed seconds from an open production event's startTime (survives reload).
function useElapsed(openEvent: { startTime: string } | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!openEvent) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [openEvent]);
  if (!openEvent) return 0;
  const start = new Date(openEvent.startTime).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

export function AssemblyView({
  operationId,
  job,
  operation,
  thumbnailPath,
  trackedEntities,
  trackedEntityId,
  materials,
  procedure,
  tools,
  ncrs,
  requiresSerialTracking,
  requiresBatchTracking,
  openEvent,
  events,
  nonConformanceActions,
  expiredEntityPolicy = "Block",
  workCenter,
  kanban,
  jobId,
  modelPath
}: Props) {
  const user = useUser();
  const mode = useMode();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  // Which main panel is shown: the assembly details, the 3D model, or chat.
  const [tab, setTab] = useState<"details" | "model" | "chat">("details");

  const issueModal = useDisclosure();
  const qualityModal = useDisclosure();
  const completeModal = useDisclosure();
  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const finishModal = useDisclosure();
  const maintenanceModal = useDisclosure();
  const serialModal = useDisclosure();
  const actionsSheet = useDisclosure();
  const imageViewer = useDisclosure();
  // Which reference image fills the main panel: a step photo (index) or the
  // finished-product image ("finished").
  const [selected, setSelected] = useState<number | "finished">("finished");
  // For non-tracked material inline issue
  const [selectedMaterial, setSelectedMaterial] = useState<any | null>(null);

  // Cumulative timer progress from all production events
  const progress = useCumulativeProgress(events);

  // Live sync — refresh loader data when this operation's events, step records,
  // job, or tracked entities change (incl. edits from the operation view).
  useRealtimeChannel({
    topic: `assembly:${operationId}`,
    dependencies: [operationId],
    setup(channel) {
      const refresh = () => revalidator.revalidate();
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${operationId}`
          },
          refresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobOperationStepRecord" },
          refresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "trackedActivity" },
          refresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=eq.${operationId}`
          },
          refresh
        );
    }
  });

  // Kanban barcode scan → complete the operation (matches the operation view).
  const completeFetcher = useFetcher();
  useKeyboardWedge({
    test: (input) =>
      kanban?.completedBarcodeOverride
        ? input === kanban.completedBarcodeOverride
        : kanban?.id
          ? input === path.to.kanbanComplete(kanban.id)
          : false,
    callback: () => completeFetcher.load(path.to.endOperation(operationId)),
    active: !!kanban?.id
  });

  // Which work types this operation actually uses (only show/select these).
  const workTypes = (
    [
      (operation?.setupDuration ?? 0) > 0 ? "Setup" : null,
      (operation?.laborDuration ?? 0) > 0 ? "Labor" : null,
      (operation?.machineDuration ?? 0) > 0 ? "Machine" : null
    ] as const
  ).filter(Boolean) as ("Setup" | "Labor" | "Machine")[];
  const [selectedWorkType, setSelectedWorkType] = useState<
    "Setup" | "Labor" | "Machine"
  >(workTypes[0] ?? "Labor");
  // Open (running) event for the selected work type, derived from events.
  const openEventForType =
    events.find((e) => e.type === selectedWorkType && !e.endTime) ??
    (selectedWorkType === "Labor" ? openEvent : null);

  const isTracked = requiresSerialTracking || requiresBatchTracking;

  // Source location for material issuing — same source the Operation view uses. FIX-7:
  // the issue modal needs it (and the work center) to resolve a stock source, which most
  // affects Inventory/Non-Inventory components.
  const layoutData = useRouteData<{ location: string }>(
    path.to.authenticatedRoot
  );
  const locationId = layoutData?.location;

  // Real build steps only. NCR actions are surfaced through the dedicated "Open NCRs"
  // sidebar + Flag-issue affordance, never injected as synthetic build steps (story 20).
  const steps = (procedure.attributes ?? [])
    .filter(
      (s) =>
        !(
          s.type === "Inspection" &&
          (s as { nonConformanceActionId?: string | null })
            .nonConformanceActionId != null
        )
    )
    .toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const parameters = procedure.parameters ?? [];

  // Group materials by their REAL item type (Part / Material / Consumable / …).
  const rawMaterials: any[] = materials?.materials ?? [];
  const materialGroups = new Map<string, any[]>();
  for (const m of rawMaterials) {
    const t = m.itemType ?? "Other";
    if (!materialGroups.has(t)) materialGroups.set(t, []);
    materialGroups.get(t)?.push(m);
  }
  const groupEntries = [...materialGroups.entries()].toSorted((a, b) => {
    const ai = TYPE_ORDER.indexOf(a[0]);
    const bi = TYPE_ORDER.indexOf(b[0]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  // Material the generic "Scan" button pre-selects. Prefer a tracked material
  // that still NEEDS issuing (otherwise the modal opens straight into the
  // "Unconsume" view because that material is already fully consumed).
  const isTrackedMat = (m: any) =>
    m.requiresSerialTracking || m.requiresBatchTracking;
  const remainingToIssue = (m: any) =>
    (m.estimatedQuantity ?? m.quantity ?? 0) - (m.quantityIssued ?? 0);
  const firstTrackedMaterial =
    rawMaterials.find((m) => isTrackedMat(m) && remainingToIssue(m) > 0) ??
    rawMaterials.find(isTrackedMat);

  // FIX-1: quantity-centric unit axis — pages "Unit X of N" for EVERY tracking type.
  // operationQuantity is the unit count; unit i carries trackedEntities[i] ?? null, so
  // Serial binds a serial per unit, Batch binds the lot to unit 0, and Inventory binds
  // none — all still page 1..N with per-unit step records. A job can pre-generate more
  // serials than the quantity, so the count caps the entity list.
  // See apps/mes/app/utils/units.ts + CONTEXT.md ("unit axis").
  const unitCount = Math.max(
    1,
    Math.round(operation?.operationQuantity ?? trackedEntities.length)
  );
  // Only serial/batch parents bind entities to the unit axis; inventory/non-inventory
  // page purely by index, so stray inventory entities must not surface as units or "S/N".
  const axisEntities = isTracked ? trackedEntities : [];
  const units = deriveUnits(unitCount, axisEntities);
  // The tracked entities within the navigable set (for the serial picker; empty when
  // the parent is untracked).
  const unitEntities = axisEntities.slice(0, unitCount);

  // Resolve the current unit: by tracked entity from the URL when present, else by the
  // ?unit index — untracked parents have no entity to key off. (FIX-3 / FIX-4)
  const unitParam = Number.parseInt(searchParams.get("unit") ?? "", 10);
  const currentUnitIndex = (() => {
    if (trackedEntityId) {
      const i = units.findIndex((u) => u.entity?.id === trackedEntityId);
      if (i >= 0) return i;
    }
    if (
      Number.isInteger(unitParam) &&
      unitParam >= 0 &&
      unitParam < units.length
    )
      return unitParam;
    return 0;
  })();
  const currentUnit = units[currentUnitIndex] ?? units[0];
  const currentEntity = currentUnit?.entity ?? undefined;

  // FIX-2: the old `isSerial` was true for batch and false for untracked — it actually
  // means "there is more than one unit to page through", for any tracking type.
  const hasUnits = units.length > 1;

  // Step records key off the unit index for ALL tracking types, identical to the
  // Operation view (FIX-1 / FIX-5) — this is what isolates unit i's records.
  const activeIndex = currentUnitIndex;
  const displayUnitIndex = currentUnitIndex;

  const prevUnit = currentUnitIndex > 0 ? units[currentUnitIndex - 1] : null;
  const nextUnit =
    currentUnitIndex < units.length - 1 ? units[currentUnitIndex + 1] : null;

  const isStepDone = (step: Step) =>
    (step.jobOperationStepRecord ?? []).some((r) => r.index === activeIndex);
  const doneCount = steps.filter(isStepDone).length;
  // All steps recorded for the current unit — drives the "Steps are missing"
  // warning in the complete/finish flow (soft warning, mirrors operation view).
  const allStepsRecorded = steps.length > 0 && doneCount === steps.length;

  // Open production events per work type (to pass to the complete flow so it
  // can close them on completion).
  const openByType = (type: string) =>
    (events.find((e) => e.type === type && !e.endTime) ?? undefined) as
      | ProductionEventType
      | undefined;

  const currentStep = Math.max(
    0,
    Math.min(
      Number.parseInt(searchParams.get("step") ?? "0", 10) || 0,
      Math.max(0, steps.length - 1)
    )
  );
  const step = steps[currentStep] ?? null;

  const stepHasDescription = richTextToPlainText(step?.description).length > 0;
  const stepDescriptionHtml =
    step && stepHasDescription
      ? generateHTML(
          stripImages(step.description) as Parameters<typeof generateHTML>[0]
        )
      : "";
  const isLastStep = steps.length === 0 || currentStep >= steps.length - 1;

  // Reference slides for this step (first-class media, ordered) + "Completed item"
  // = the finished product (the assembly item's thumbnail). See PRD-step-reference-images.
  const stepSlides = (step?.jobOperationStepSlide ?? [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const stepImages = stepSlides.map((s) => getPrivateUrl(s.imagePath));
  const assemblyImage = thumbnailPath ? getPrivateUrl(thumbnailPath) : null;
  const mainImage =
    selected === "finished"
      ? assemblyImage
      : (stepImages[selected] ?? assemblyImage);
  const selectedCaption =
    typeof selected === "number"
      ? (stepSlides[selected]?.caption ?? null)
      : null;

  // On step change, default the main panel to the step's first slide so reference art
  // shows immediately; only fall back to the finished-assembly image when the step has
  // no slides.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the current step
  useEffect(() => {
    setSelected(stepSlides.length > 0 ? 0 : "finished");
  }, [currentStep, stepSlides.length]);

  function goToStep(n: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("step", String(n));
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  function navigateEntity(entity: { id: string }) {
    const url = new URL(window.location.href);
    url.searchParams.set("trackedEntityId", entity.id);
    url.searchParams.delete("unit");
    navigate(url.pathname + url.search);
  }

  // Navigate to a unit by its axis position. Tracked units key off their entity (the
  // loader refetches that entity's materials); untracked units key off ?unit (no entity
  // to scan — FIX-3/FIX-4), which the loader resolves without a tracked entity.
  function navigateToUnit(unit: {
    index: number;
    entity: { id: string } | null;
  }) {
    if (unit.entity) {
      navigateEntity(unit.entity);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("unit", String(unit.index));
        next.delete("trackedEntityId");
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border pl-1">
        <SidebarTrigger />
        <div className="hidden h-full shrink-0 items-center border-l border-border px-4 sm:flex">
          {companyLogo ? (
            <img
              src={companyLogo}
              alt={`${user.company.name} logo`}
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <span className="whitespace-nowrap text-base font-bold tracking-tight">
              {user.company.name}
            </span>
          )}
        </div>

        <div className="flex h-full min-w-0 items-center gap-2 border-r border-border px-3 md:px-5">
          <span className="truncate text-sm font-semibold">
            {job?.itemReadableIdWithRevision ?? "—"}
          </span>
          {operation?.description ? (
            <>
              <span className="hidden text-muted-foreground md:inline">·</span>
              <span className="hidden truncate text-sm text-foreground/90 lg:inline">
                {operation.description}
              </span>
            </>
          ) : null}
        </div>

        {hasUnits && (
          <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-border px-2 md:gap-3 md:px-5">
            <span className="whitespace-nowrap text-sm font-medium">
              Unit <span className="font-bold">{displayUnitIndex + 1}</span>{" "}
              <span className="text-muted-foreground">of {units.length}</span>
            </span>
            <div className="hidden h-[18px] items-end gap-0.5 md:flex">
              {SIGNAL_HEIGHTS.map((h, i) => {
                const filled =
                  i <=
                  Math.floor(
                    ((displayUnitIndex + 1) / units.length) *
                      SIGNAL_HEIGHTS.length
                  );
                return (
                  <div
                    key={h}
                    className={cn(
                      "w-[3px] rounded-sm",
                      h,
                      filled ? "bg-foreground" : "bg-muted-foreground/30"
                    )}
                  />
                );
              })}
            </div>
            <div className="flex">
              <Button
                variant="ghost"
                size="md"
                isIcon
                aria-label="Previous unit"
                isDisabled={!prevUnit}
                onClick={() => prevUnit && navigateToUnit(prevUnit)}
              >
                <LuChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="md"
                isIcon
                aria-label="Next unit"
                isDisabled={!nextUnit}
                onClick={() => nextUnit && navigateToUnit(nextUnit)}
              >
                <LuChevronRight />
              </Button>
              {/* Scan + print-label are entity-specific — hidden when the current unit
                  has no tracked identity (untracked parents). */}
              {currentEntity && (
                <>
                  <Button
                    variant="ghost"
                    size="md"
                    isIcon
                    aria-label="Select unit"
                    className="hidden sm:inline-flex"
                    onClick={serialModal.onOpen}
                  >
                    <LuBarcode />
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    isIcon
                    aria-label="Print label"
                    className="hidden sm:inline-flex"
                    onClick={() =>
                      window.open(
                        window.location.origin +
                          path.to.file.operationLabelsPdf(operationId, {
                            trackedEntityId: currentEntity?.id
                          }),
                        "_blank"
                      )
                    }
                  >
                    <LuPrinter />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 md:gap-2 md:px-4">
          <Button
            variant="outline"
            size="lg"
            leftIcon={<LuFlag />}
            className="hidden lg:flex"
            onClick={qualityModal.onOpen}
          >
            Flag issue
          </Button>
          {operation ? (
            <Button
              variant="primary"
              size="lg"
              leftIcon={<LuCheck />}
              onClick={completeModal.onOpen}
            >
              <span className="hidden sm:inline">Complete</span>
              <span className="sm:hidden">Done</span>
            </Button>
          ) : null}
          {operation ? (
            <Button
              variant="ghost"
              size="md"
              isIcon
              aria-label="More actions"
              onClick={actionsSheet.onOpen}
            >
              <LuEllipsisVertical />
            </Button>
          ) : null}
        </div>

        {operation ? (
          <TimerControl
            operation={operation}
            openEvent={openEventForType}
            workType={selectedWorkType}
            trackedEntityId={isTracked ? currentEntity?.id : undefined}
          />
        ) : null}
      </header>

      {/* ── STEPS BAR (segmented, click to jump; green = done) ── */}
      {steps.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-3 bg-card border-b border-border px-5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {doneCount} / {steps.length} done
          </span>
          <div className="flex flex-1 gap-1">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => goToStep(i)}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  isStepDone(s)
                    ? "bg-emerald-500"
                    : i === currentStep
                      ? "bg-foreground"
                      : "bg-border hover:bg-muted-foreground/40"
                )}
              />
            ))}
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {currentStep + 1} / {steps.length}
          </span>
        </div>
      )}

      {/* ── BODY ── stacks vertically (page scrolls) on phones/tablets,
          three columns side-by-side on lg+. ── */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── LEFT PANEL: part detail + timer + containment ── */}
        <aside className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-border bg-card lg:flex xl:w-[280px]">
          {/* Part info */}
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <p className="truncate text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {job?.itemReadableIdWithRevision ?? "—"}
            </p>
            {operation?.itemDescription && (
              <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">
                {operation.itemDescription}
              </p>
            )}
            {currentEntity && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {requiresBatchTracking ? "Batch" : "S/N"}
                </Badge>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {currentEntity.readableId ?? currentEntity.id.slice(-8)}
                </span>
              </div>
            )}
          </div>

          {/* Cumulative timer — click a row to choose which clock the play
              button tracks. Only work types this operation uses are shown. */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Time
            </p>
            {(operation?.setupDuration ?? 0) > 0 && (
              <TimerRow
                icon={<LuTimer className="size-3" />}
                label="Setup"
                elapsed={progress.setup}
                total={operation?.setupDuration ?? 0}
                selected={selectedWorkType === "Setup"}
                onSelect={() => setSelectedWorkType("Setup")}
              />
            )}
            {(operation?.laborDuration ?? 0) > 0 && (
              <TimerRow
                icon={<LuHardHat className="size-3" />}
                label="Labor"
                elapsed={progress.labor}
                total={operation?.laborDuration ?? 0}
                selected={selectedWorkType === "Labor"}
                onSelect={() => setSelectedWorkType("Labor")}
              />
            )}
            {(operation?.machineDuration ?? 0) > 0 && (
              <TimerRow
                icon={<LuHammer className="size-3" />}
                label="Machine"
                elapsed={progress.machine}
                total={operation?.machineDuration ?? 0}
                selected={selectedWorkType === "Machine"}
                onSelect={() => setSelectedWorkType("Machine")}
              />
            )}
            {/* Steps done count */}
            {steps.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Steps
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {doneCount}/{steps.length}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Containment actions (NCR-driven) — collapsible accordion at the
              bottom of the left panel. Click a row to expand/collapse. */}
          {(() => {
            const containments = nonConformanceActions.filter(
              (a) => a.notes && Object.keys(a.notes as object).length > 0
            );
            if (containments.length === 0) return null;
            return (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
                <p className="mb-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Containment
                </p>
                <Accordion type="multiple" className="flex flex-col">
                  {containments.map((action) => (
                    <AccordionItem
                      key={action.id}
                      value={action.id}
                      className="border-b-0"
                    >
                      <AccordionTrigger className="gap-2 py-2 text-left text-xs hover:no-underline">
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                          <span className="truncate font-semibold leading-tight text-foreground">
                            {action.actionTypeName}
                          </span>
                          <Badge
                            variant="outline"
                            className="w-fit font-mono text-[9px]"
                          >
                            {action.nonConformanceId}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2 pt-0">
                        <div
                          className="prose prose-sm max-w-none rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-foreground/90 dark:prose-invert"
                          dangerouslySetInnerHTML={{
                            __html: generateHTML(
                              action.notes as Parameters<typeof generateHTML>[0]
                            )
                          }}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            );
          })()}

          {/* Operation status — mirrors the operation view's header strip. */}
          {operation && (
            <div className="mt-auto flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              {operation.jobReadableId && (
                <StatusRow label="Job" value={operation.jobReadableId} mono />
              )}
              {operation.description && (
                <StatusRow label="Operation" value={operation.description} />
              )}
              <StatusRow
                label="State"
                value={
                  operation.jobStatus === "Paused"
                    ? "Paused"
                    : (operation.operationStatus ?? "—")
                }
              />
              <StatusRow
                label="Duration"
                value={formatDurationMilliseconds(operation.duration ?? 0, {
                  style: "short"
                })}
              />
              <StatusRow
                label="Deadline"
                value={operation.jobDeadlineType ?? "—"}
              />
            </div>
          )}
        </aside>

        {/* ── MAIN: tabbed — details (image + step) · model · chat ── */}
        <main className="flex w-full flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
            <TabButton
              active={tab === "details"}
              onClick={() => setTab("details")}
            >
              Details
            </TabButton>
            {modelPath ? (
              <TabButton
                active={tab === "model"}
                onClick={() => setTab("model")}
              >
                Model
              </TabButton>
            ) : null}
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
              Chat
            </TabButton>
          </div>

          {tab === "model" && modelPath ? (
            <div className="min-h-0 flex-1">
              <ModelViewer
                file={null}
                key={`model-${modelPath}`}
                url={`/file/preview/private/${modelPath}`}
                mode={mode}
                className="rounded-none"
              />
            </div>
          ) : tab === "chat" && operation ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <OperationChat
                operation={operation as unknown as OperationWithDetails}
              />
            </div>
          ) : (
            <>
              <div className="flex h-[42vh] shrink-0 flex-col gap-2 border-b border-border p-4 lg:h-auto lg:min-h-0 lg:grow-[7] lg:basis-0">
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                  {mainImage ? (
                    <>
                      <button
                        type="button"
                        aria-label="View image full screen"
                        onClick={imageViewer.onOpen}
                        className="flex h-full w-full items-center justify-center"
                      >
                        <img
                          src={mainImage}
                          alt="Assembly reference"
                          className="max-h-full max-w-full object-contain"
                        />
                      </button>
                      <span className="pointer-events-none absolute right-2 top-2 flex items-center justify-center rounded-md bg-background/80 p-1.5 text-muted-foreground shadow-sm">
                        <LuExpand className="size-4" />
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <LuImage className="size-8" />
                      <span className="text-xs">No reference image</span>
                    </div>
                  )}
                </div>

                {selectedCaption && (
                  <p className="shrink-0 truncate text-center text-xs text-muted-foreground">
                    {selectedCaption}
                  </p>
                )}

                {/* Slots = this step's slides · "Completed item" = the finished product. */}
                <div className="flex shrink-0 items-center gap-2">
                  {stepSlides.map((slide, i) => (
                    <button
                      key={slide.id}
                      type="button"
                      aria-label={slide.caption || `Slide ${i + 1}`}
                      title={slide.caption ?? undefined}
                      onClick={() => setSelected(i)}
                      className={cn(
                        "flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-muted/40",
                        selected === i
                          ? "border-foreground"
                          : "border-transparent"
                      )}
                    >
                      <img
                        src={stepImages[i]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                  <div className="flex-1" />
                  <Button
                    variant={selected === "finished" ? "primary" : "outline"}
                    size="lg"
                    className="gap-2"
                    isDisabled={!assemblyImage}
                    onClick={() => setSelected("finished")}
                  >
                    {assemblyImage ? (
                      <span className="flex h-7 w-9 items-center justify-center overflow-hidden rounded bg-muted/40">
                        <img
                          src={assemblyImage}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : (
                      <LuImage className="size-4" />
                    )}
                    Completed item
                  </Button>
                </div>
              </div>

              {/* Current step */}
              <div className="flex flex-col gap-3 p-6 lg:min-h-0 lg:grow-[3] lg:basis-0 lg:overflow-y-auto">
                {step ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                        {currentStep + 1}
                      </span>
                      {isStepDone(step) && <Badge variant="green">Done</Badge>}
                      {step.type ? (
                        <Badge variant="secondary" className="normal-case">
                          {step.type}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-lg font-medium leading-relaxed">
                      {step.name ?? `Step ${currentStep + 1}`}
                    </p>
                    {stepDescriptionHtml ? (
                      <div
                        className="prose prose-sm max-w-none text-sm text-foreground dark:prose-invert"
                        dangerouslySetInnerHTML={{
                          __html: stepDescriptionHtml
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No steps defined for this operation.
                  </p>
                )}
              </div>
            </>
          )}
        </main>

        {/* ── SIDEBAR: materials, tools, NCRs, parameters ── */}
        <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card lg:w-[280px] lg:overflow-hidden lg:border-l lg:border-t-0 xl:w-[320px]">
          <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            {groupEntries.length > 0 ? (
              groupEntries.map(([type, mats]) => (
                <SidebarSection key={type} title={pluralize(type)} scrollable>
                  {mats.map((m, i) => (
                    <MaterialRow
                      key={m.id ?? i}
                      material={m}
                      onIssue={() => {
                        setSelectedMaterial(m);
                        issueModal.onOpen();
                      }}
                    />
                  ))}
                </SidebarSection>
              ))
            ) : (
              <SidebarSection title="Parts">
                <p className="text-xs text-muted-foreground">
                  No materials assigned
                </p>
              </SidebarSection>
            )}

            {tools.length > 0 && (
              <SidebarSection title="Tools" scrollable>
                {tools.map((t, i) => (
                  <div
                    key={t.item?.id ?? i}
                    className="flex items-center gap-2 py-1"
                  >
                    <LuWrench className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-xs">
                      {t.item?.name ?? "Unknown tool"}
                    </span>
                    {t.quantity > 1 && (
                      <span className="text-xs text-muted-foreground">
                        ×{t.quantity}
                      </span>
                    )}
                  </div>
                ))}
              </SidebarSection>
            )}

            {isTracked && firstTrackedMaterial && (
              <SidebarSection title="Scan Part">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  leftIcon={<LuQrCode />}
                  onClick={() => {
                    // Pre-select a tracked material so the modal opens directly
                    // into the serial/batch scan view (same as the per-row QR).
                    setSelectedMaterial(firstTrackedMaterial);
                    issueModal.onOpen();
                  }}
                >
                  Scan
                </Button>
              </SidebarSection>
            )}

            {ncrs.length > 0 && (
              <SidebarSection title="Open NCRs">
                {ncrs.map((ncr, i) => {
                  const nc = ncr.nonConformance;
                  const isClosed = nc?.status === "Closed";
                  const readableId =
                    nc?.nonConformanceId ?? ncr.nonConformanceId;
                  return (
                    <div key={readableId ?? i} className="py-1">
                      <Status color={isClosed ? "green" : "red"}>
                        {readableId}
                      </Status>
                    </div>
                  );
                })}
              </SidebarSection>
            )}

            {parameters.length > 0 ? (
              <SidebarSection title="Parameters">
                {parameters.map((p, i) => (
                  <div
                    key={p.id ?? p.key ?? i}
                    className="flex justify-between py-0.5"
                  >
                    <span className="text-xs text-muted-foreground">
                      {p.key}
                    </span>
                    <span className="text-xs font-medium">{p.value}</span>
                  </div>
                ))}
              </SidebarSection>
            ) : null}
          </div>

          {/* ── ACTIONS: Complete Step + Skip, side by side ── */}
          <div className="flex w-full shrink-0 items-stretch gap-2 border-t border-border p-3">
            {step && (
              <div className="min-w-0 flex-1">
                <StepCompleteAction
                  step={step}
                  activeIndex={activeIndex}
                  done={isStepDone(step)}
                />
              </div>
            )}
            <Button
              variant="outline"
              size="lg"
              className="shrink-0"
              rightIcon={<LuSkipForward />}
              isDisabled={isLastStep}
              onClick={() => goToStep(currentStep + 1)}
            >
              Skip
            </Button>
          </div>
        </aside>
      </div>

      {issueModal.isOpen && (
        <IssueMaterialModal
          operationId={operationId}
          expiredEntityPolicy={expiredEntityPolicy}
          locationId={locationId}
          workCenterId={operation?.workCenterId ?? undefined}
          material={selectedMaterial ?? undefined}
          parentId={currentEntity?.id ?? ""}
          parentIdIsSerialized={requiresSerialTracking}
          trackedInputs={materials?.trackedInputs ?? []}
          onClose={() => {
            setSelectedMaterial(null);
            issueModal.onClose();
          }}
        />
      )}

      <QualityIssueModal
        operationId={operationId}
        trackedEntityId={isTracked ? currentEntity?.id : undefined}
        isOpen={qualityModal.isOpen}
        onClose={qualityModal.onClose}
      />

      {completeModal.isOpen && operation && (
        <QuantityModal
          type="complete"
          operation={operation as unknown as OperationWithDetails}
          materials={(materials?.materials ?? []) as JobMaterial[]}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded={allStepsRecorded}
          onClose={completeModal.onClose}
        />
      )}

      {scrapModal.isOpen && operation && (
        <QuantityModal
          type="scrap"
          operation={operation as unknown as OperationWithDetails}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          onClose={scrapModal.onClose}
        />
      )}

      {finishModal.isOpen && operation && (
        <QuantityModal
          type="finish"
          operation={operation as unknown as OperationWithDetails}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded={allStepsRecorded}
          onClose={finishModal.onClose}
        />
      )}

      {reworkModal.isOpen && operation && jobId && (
        <ReworkModal
          operation={operation as unknown as OperationWithDetails}
          jobId={jobId}
          isOpen={reworkModal.isOpen}
          onClose={reworkModal.onClose}
          trackedEntities={trackedEntities as never}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
        />
      )}

      {workCenter && (
        <MaintenanceDispatch
          workCenter={workCenter}
          isOpen={maintenanceModal.isOpen}
          onClose={maintenanceModal.onClose}
        />
      )}

      {serialModal.isOpen && (
        <SerialSelectorModal
          availableEntities={unitEntities as never}
          onClose={serialModal.onClose}
          onCancel={serialModal.onClose}
          onSelect={(entity) => {
            navigateEntity(entity);
            serialModal.onClose();
          }}
        />
      )}

      <BottomSheet
        open={actionsSheet.isOpen}
        onOpenChange={(open) => {
          if (!open) actionsSheet.onClose();
        }}
      >
        <BottomSheetContent className="mx-auto max-w-md">
          <BottomSheetBody>
            <div className="flex flex-col gap-2 pb-2">
              <ActionSheetButton
                icon={<LuTrash className="size-4 shrink-0" />}
                label="Scrap"
                onClick={() => {
                  actionsSheet.onClose();
                  scrapModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuGitPullRequest className="size-4 shrink-0" />}
                label="Rework"
                onClick={() => {
                  actionsSheet.onClose();
                  reworkModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuCheck className="size-4 shrink-0" />}
                label="Finish"
                onClick={() => {
                  actionsSheet.onClose();
                  finishModal.onOpen();
                }}
              />
              {workCenter && !workCenter.isBlocked ? (
                <ActionSheetButton
                  icon={<LuWrench className="size-4 shrink-0" />}
                  label="Maintenance"
                  onClick={() => {
                    actionsSheet.onClose();
                    maintenanceModal.onOpen();
                  }}
                />
              ) : null}
              <ActionSheetButton
                icon={<LuFlag className="size-4 shrink-0" />}
                label="Quality Issue"
                onClick={() => {
                  actionsSheet.onClose();
                  qualityModal.onOpen();
                }}
              />
            </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      <ImageZoomViewer
        open={imageViewer.isOpen}
        src={mainImage}
        caption={selectedCaption}
        onClose={imageViewer.onClose}
      />
    </div>
  );
}

function ActionSheetButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 transition-transform active:scale-[0.98]"
      onClick={onClick}
    >
      {icon}
      <span className="text-base/6 font-medium">{label}</span>
    </button>
  );
}

function TimerControl({
  operation,
  openEvent,
  workType,
  trackedEntityId
}: {
  operation: Operation;
  openEvent: { id: string; startTime: string } | null;
  workType: "Setup" | "Labor" | "Machine";
  trackedEntityId?: string;
}) {
  const fetcher = useFetcher();

  // Optimistic state: the moment Start/End is submitted, flip immediately
  // instead of waiting for the (slow) post-production-event round-trip. This
  // stops the clock the instant you press pause — no lingering "spinning"
  // while the timer keeps climbing.
  const pendingAction = fetcher.formData?.get("action");
  const active =
    pendingAction === "Start"
      ? true
      : pendingAction === "End"
        ? false
        : !!openEvent;

  // Freeze the clock while a stop is in flight; otherwise tick live.
  const liveElapsed = useElapsed(pendingAction === "End" ? null : openEvent);
  const elapsed = pendingAction === "End" ? 0 : liveElapsed;

  return (
    <div className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 md:gap-2 md:px-4">
      <span className="hidden flex-col items-end leading-none sm:flex">
        <span className="text-sm font-medium tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          {workType}
        </span>
      </span>
      <fetcher.Form method="post" action={path.to.productionEvent}>
        <input type="hidden" name="jobOperationId" value={operation.id} />
        <input type="hidden" name="timezone" value={getLocalTimeZone()} />
        <input type="hidden" name="type" value={workType} />
        <input
          type="hidden"
          name="action"
          value={openEvent ? "End" : "Start"}
        />
        {operation.workCenterId ? (
          <input
            type="hidden"
            name="workCenterId"
            value={operation.workCenterId}
          />
        ) : null}
        {openEvent ? (
          <input type="hidden" name="id" value={openEvent.id} />
        ) : null}
        {trackedEntityId ? (
          <input type="hidden" name="trackedEntityId" value={trackedEntityId} />
        ) : null}
        <Button
          type="submit"
          variant="ghost"
          size="md"
          isIcon
          aria-label={active ? "Pause timer" : "Start timer"}
        >
          {active ? <LuPause /> : <LuPlay />}
        </Button>
      </fetcher.Form>
    </div>
  );
}

function SidebarSection({
  title,
  children,
  scrollable
}: {
  title: string;
  children: React.ReactNode;
  scrollable?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col",
        // On mobile every section flows at its natural height (the page
        // scrolls). On lg+ scrollable sections share the panel and scroll
        // internally.
        scrollable ? "lg:min-h-0 lg:flex-1" : "shrink-0"
      )}
    >
      <Separator />
      <h3 className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div
        className={cn(
          "px-3.5 pb-2.5",
          scrollable && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function MaterialRow({
  material,
  onIssue
}: {
  material: any;
  onIssue?: () => void;
}) {
  const isTracked =
    material.requiresSerialTracking || material.requiresBatchTracking;
  // Tracked sub-assemblies are issued PER UNIT, so the requirement is the
  // per-unit `quantity` (e.g. 1), not `estimatedQuantity` (the total across all
  // units, e.g. 20). Non-tracked materials use the total estimated quantity.
  // Mirrors the operation view (issued/quantity for tracked, total otherwise).
  const required = isTracked
    ? (material.quantity ?? material.estimatedQuantity ?? 0)
    : (material.estimatedQuantity ?? material.quantity ?? 0);
  const issued = material.quantityIssued ?? 0;
  const fullyIssued = required > 0 && issued >= required;
  const partiallyIssued = issued > 0 && !fullyIssued;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[56px] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
        {material.itemReadableId}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-xs">{material.description}</span>
        {material.requiresSerialTracking && <Badge variant="blue">S/N</Badge>}
        {material.requiresBatchTracking && (
          <Badge variant="purple">Batch</Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {fullyIssued ? (
          <span className="flex items-center gap-1 text-[10px] font-medium tabular-nums text-emerald-500">
            {issued}/{required}
            <LuCheck className="size-3" />
          </span>
        ) : partiallyIssued ? (
          <span className="text-[10px] tabular-nums text-amber-500">
            {issued}/{required}
          </span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            ×{required}
          </span>
        )}
        {/* Once fully issued there's nothing left to scan/add — hide the action. */}
        {onIssue && !fullyIssued && (
          <button
            type="button"
            aria-label={isTracked ? "Scan material" : "Issue material"}
            onClick={onIssue}
            className="ml-0.5 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors active:scale-[0.96]"
          >
            {isTracked ? (
              <LuQrCode className="size-4" />
            ) : (
              <LuGitBranchPlus className="size-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Per-step completion action ──────────────────────────────────────────────

function StepCompleteAction({
  step,
  activeIndex,
  done
}: {
  step: Step;
  activeIndex: number;
  done: boolean;
}) {
  const fetcher = useFetcher();
  const user = useUser();
  const busy = fetcher.state !== "idle";
  const recordModal = useDisclosure();

  // Find the existing record for this unit (if done)
  const record = (step.jobOperationStepRecord ?? []).find(
    (r) => r.index === activeIndex
  );
  // A record can only be undone by whoever created it (the delete RPC filters
  // by createdBy) — mirror the operation view and disable undo otherwise.
  const canUndo = !!record && record.createdBy === user.id;

  const type = step.type ?? "Task";

  // Undo: delete the record so step can be re-done
  function handleUndo() {
    if (!record) return;
    fetcher.submit(null, {
      method: "post",
      action: path.to.recordDelete(record.id)
    });
  }

  // Quick-complete a Task step (no captured value — matches the operation view).
  function markTaskDone() {
    const fd = new FormData();
    fd.append("jobOperationStepId", step.id);
    fd.append("index", String(activeIndex));
    fd.append("booleanValue", "true");
    fetcher.submit(fd, { method: "post", action: path.to.record });
  }

  // ── Already done: show recorded value + Undo button ──
  if (done && record) {
    let recordedDisplay: string | null = null;
    if (record.numericValue != null)
      recordedDisplay = `${record.numericValue}${step.unitOfMeasureCode ? ` ${step.unitOfMeasureCode}` : ""}`;
    else if (record.booleanValue != null)
      recordedDisplay = record.booleanValue ? "Yes" : "No";
    else if (record.value) recordedDisplay = record.value;
    else if (record.userValue) recordedDisplay = record.userValue;

    // File steps store a long storage path — show just the file name; the full
    // path stays available in the truncation tooltip.
    const displayText =
      type === "File" && recordedDisplay
        ? recordedDisplay.split("/").pop() || recordedDisplay
        : recordedDisplay;

    return (
      <div className="flex h-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
        <LuCheck className="size-4 shrink-0 text-emerald-500" />
        {displayText ? (
          <TruncatedTooltipText
            tooltip={recordedDisplay}
            className="min-w-0 flex-1 truncate text-sm text-emerald-600 dark:text-emerald-400"
          >
            Recorded: {displayText}
          </TruncatedTooltipText>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-emerald-600 dark:text-emerald-400">
            Completed
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          isIcon
          aria-label="Undo"
          isLoading={busy}
          isDisabled={!canUndo}
          title={
            canUndo ? "Undo" : "Only the operator who recorded this can undo it"
          }
          onClick={handleUndo}
        >
          <LuUndo2 className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  // ── Not done ──
  // Task → quick "Mark done" submit. Every other type (Value, Measurement,
  // Checkbox, List, Person, Timestamp, File, Inspection) opens the shared
  // RecordModal — same component the operation view uses (incl. file upload).
  if (type === "Task") {
    return (
      <Button
        variant="primary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={busy}
        className="w-full"
        onClick={markTaskDone}
      >
        Mark done
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        leftIcon={<LuCheck />}
        className="w-full"
        onClick={recordModal.onOpen}
      >
        Record
      </Button>
      {recordModal.isOpen && (
        <RecordModal
          attribute={step as unknown as JobOperationStep}
          activeStep={activeIndex}
          onClose={recordModal.onClose}
        />
      )}
    </>
  );
}

// Compact tab button for the main panel (Details / Model / Chat).
function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// Label · value row for the left-panel Status section.
function StatusRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[11px] font-medium text-foreground",
          mono && "font-mono"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Cumulative production event timer ───────────────────────────────────────

function useCumulativeProgress(events: ProductionEvent[]) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const hasOpen = events.some((e) => !e.endTime);
    if (!hasOpen) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [events]);

  const totals = { setup: 0, labor: 0, machine: 0 };
  const now = Date.now();

  for (const ev of events) {
    const rawKey = (ev.type ?? "labor").toLowerCase();
    const key = rawKey as keyof typeof totals;
    if (!(key in totals)) continue;
    if (ev.endTime) {
      // Completed event — use stored duration (ms) if present, else calculate
      totals[key] +=
        ev.duration != null
          ? ev.duration * 1000
          : new Date(ev.endTime).getTime() - new Date(ev.startTime).getTime();
    } else {
      // Open event — live elapsed
      totals[key] += Math.max(0, now - new Date(ev.startTime).getTime());
    }
  }

  return totals;
}

// Single timer row: icon · "3s / 6m" · progress bar
function TimerRow({
  icon,
  label,
  elapsed,
  total,
  selected,
  onSelect
}: {
  icon: React.ReactNode;
  label: string;
  elapsed: number;
  total: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const overrun = total > 0 && elapsed > total;
  const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md px-1.5 py-1 text-left transition-colors",
        onSelect && "hover:bg-muted/60",
        selected && "bg-foreground/10"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex items-center gap-1 text-[10px]",
            selected ? "font-semibold text-foreground" : "text-muted-foreground"
          )}
        >
          {/* selected indicator dot */}
          {onSelect && (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                selected ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
          )}
          {icon}
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums",
            overrun ? "text-red-500" : "text-muted-foreground"
          )}
        >
          {formatDurationMilliseconds(elapsed, { style: "short" })}
          {total > 0 && (
            <>/{formatDurationMilliseconds(total, { style: "short" })}</>
          )}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            overrun ? "bg-red-500" : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}
