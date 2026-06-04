import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Avatar,
  Badge,
  Button,
  cn,
  generateHTML,
  Separator,
  SidebarTrigger,
  Status,
  useDisclosure,
  useMode
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { useEffect, useState } from "react";
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuFlag,
  LuGitBranchPlus,
  LuHammer,
  LuHardHat,
  LuImage,
  LuPause,
  LuPlay,
  LuQrCode,
  LuSkipForward,
  LuTimer,
  LuUndo2,
  LuWrench
} from "react-icons/lu";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { IssueMaterialModal } from "~/components/JobOperation/components/IssueMaterialModal";
import { QualityIssueModal } from "~/components/JobOperation/components/QualityIssueModal";
import { useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";

type StepRecord = {
  id: string;
  index: number;
  value?: string | null;
  numericValue?: number | null;
  booleanValue?: boolean | null;
  userValue?: string | null;
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
};

type Props = {
  operationId: string;
  job: { itemReadableIdWithRevision?: string | null } | null;
  operation: Operation | null;
  thumbnailPath: string | null | undefined;
  trackedEntities: { id: string; readableId?: string | null }[];
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

const THUMB_SLOTS = ["slot-a", "slot-b", "slot-c"];

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

// Collect image srcs embedded in a TipTap description (image nodes).
function extractImages(doc: unknown): string[] {
  if (!doc || typeof doc !== "object") return [];
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && typeof node.attrs?.src === "string")
      out.push(node.attrs.src);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return out;
}

// Strip image nodes so the prose shows text only — images become the slots.
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
  nonConformanceActions
}: Props) {
  const user = useUser();
  const mode = useMode();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const issueModal = useDisclosure();
  const qualityModal = useDisclosure();
  // Which reference image fills the main panel: a step photo (index) or the
  // finished-assembly image ("assy").
  const [selected, setSelected] = useState<number | "assy">("assy");
  // For non-tracked material inline issue
  const [selectedMaterial, setSelectedMaterial] = useState<any | null>(null);

  // Cumulative timer progress from all production events
  const progress = useCumulativeProgress(events);

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
  const isSerial = isTracked && trackedEntities.length > 0;

  const steps = (procedure.attributes ?? []).toSorted(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
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

  // First serial/batch-tracked material — the generic "Scan" button pre-selects
  // it so the modal opens straight into the serial-number scan view (not the
  // empty "select an item" picker).
  const firstTrackedMaterial = rawMaterials.find(
    (m) => m.requiresSerialTracking || m.requiresBatchTracking
  );

  const torqueParam = parameters.find((p) =>
    p.key?.toLowerCase().includes("torque")
  );

  const currentEntityIndex = trackedEntityId
    ? Math.max(
        0,
        trackedEntities.findIndex((te) => te.id === trackedEntityId)
      )
    : 0;
  const currentEntity = trackedEntities[currentEntityIndex];
  const prevEntity =
    currentEntityIndex > 0 ? trackedEntities[currentEntityIndex - 1] : null;
  const nextEntity =
    currentEntityIndex < trackedEntities.length - 1
      ? trackedEntities[currentEntityIndex + 1]
      : null;

  // The record "index" axis: per-unit when tracked, single pass (0) otherwise.
  const activeIndex = isTracked ? currentEntityIndex : 0;

  const isStepDone = (step: Step) =>
    (step.jobOperationStepRecord ?? []).some((r) => r.index === activeIndex);
  const doneCount = steps.filter(isStepDone).length;

  const currentStep = Math.max(
    0,
    Math.min(
      Number.parseInt(searchParams.get("step") ?? "0", 10) || 0,
      Math.max(0, steps.length - 1)
    )
  );
  const step = steps[currentStep] ?? null;

  // Reset to the finished-assembly image whenever the step changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on step change
  useEffect(() => setSelected("assy"), [currentStep]);

  const stepHasDescription = richTextToPlainText(step?.description).length > 0;
  const stepDescriptionHtml =
    step && stepHasDescription
      ? generateHTML(
          stripImages(step.description) as Parameters<typeof generateHTML>[0]
        )
      : "";
  const isLastStep = steps.length === 0 || currentStep >= steps.length - 1;

  // The 3 slots = this step's reference photos; "Completed assy" = the finished
  // product (the assembly item's thumbnail).
  // POC: the reference art on these jobs is placeholder/junk, so we ignore it
  // and render the empty-state placeholder. Flip to `true` once real reference
  // images are attached to the steps/item.
  const SHOW_REFERENCE_IMAGES = false;
  const stepImages = SHOW_REFERENCE_IMAGES
    ? extractImages(step?.description)
    : [];
  const assemblyImage =
    SHOW_REFERENCE_IMAGES && thumbnailPath
      ? getPrivateUrl(thumbnailPath)
      : null;
  const mainImage =
    selected === "assy"
      ? assemblyImage
      : (stepImages[selected] ?? assemblyImage);

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
    navigate(url.pathname + url.search);
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border pl-1">
        <SidebarTrigger />
        <div className="flex h-full items-center border-l border-border px-4">
          {companyLogo ? (
            <img
              src={companyLogo}
              alt={`${user.company.name} logo`}
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <span className="text-base font-bold tracking-tight">
              {user.company.name}
            </span>
          )}
        </div>

        <div className="flex h-full items-center gap-2 border-r border-border px-5">
          <span className="text-sm font-semibold">
            {job?.itemReadableIdWithRevision ?? "—"}
          </span>
          {operation?.description ? (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-foreground/90">
                {operation.description}
              </span>
            </>
          ) : null}
        </div>

        {isSerial && (
          <div className="flex h-full items-center gap-3 border-r border-border px-5">
            <span className="whitespace-nowrap text-sm font-medium">
              Unit <span className="font-bold">{currentEntityIndex + 1}</span>{" "}
              <span className="text-muted-foreground">
                of {trackedEntities.length}
              </span>
            </span>
            <div className="flex h-[18px] items-end gap-0.5">
              {SIGNAL_HEIGHTS.map((h, i) => {
                const filled =
                  i <=
                  Math.floor(
                    ((currentEntityIndex + 1) / trackedEntities.length) *
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
                size="sm"
                isIcon
                aria-label="Previous unit"
                isDisabled={!prevEntity}
                onClick={() => prevEntity && navigateEntity(prevEntity)}
              >
                <LuChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isIcon
                aria-label="Next unit"
                isDisabled={!nextEntity}
                onClick={() => nextEntity && navigateEntity(nextEntity)}
              >
                <LuChevronRight />
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1" />

        {operation ? (
          <TimerControl
            operation={operation}
            openEvent={openEventForType}
            workType={selectedWorkType}
            trackedEntityId={isTracked ? currentEntity?.id : undefined}
          />
        ) : null}

        <div className="flex h-full items-center border-l border-border px-4">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<LuFlag />}
            onClick={qualityModal.onOpen}
          >
            Flag issue
          </Button>
        </div>

        <div className="flex h-full items-center px-4">
          <Avatar
            name={fullName || "?"}
            src={user.avatarUrl ?? undefined}
            size="md"
          />
        </div>
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

      {/* ── BODY ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL: part detail + timer + containment ── */}
        <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
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
            {isSerial && currentEntity && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  S/N
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
        </aside>

        {/* ── MAIN: reference image + containment + current step ── */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 grow-[7] basis-0 flex-col gap-2 border-b border-border p-4">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
              {mainImage ? (
                <img
                  src={mainImage}
                  alt="Assembly reference"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <LuImage className="size-8" />
                  <span className="text-xs">No reference image</span>
                </div>
              )}
            </div>

            {/* Slots = this step's photos · "Completed assy" = the finished product. */}
            <div className="flex shrink-0 items-center gap-2">
              {THUMB_SLOTS.map((slotKey, i) => {
                const src = stepImages[i] ?? null;
                return (
                  <button
                    key={slotKey}
                    type="button"
                    disabled={!src}
                    aria-label={`Step image ${i + 1}`}
                    onClick={() => src && setSelected(i)}
                    className={cn(
                      "flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-muted/40",
                      src && selected === i
                        ? "border-foreground"
                        : "border-transparent",
                      !src && "cursor-default"
                    )}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <LuImage className="size-4 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
              <div className="flex-1" />
              <Button
                variant={selected === "assy" ? "primary" : "outline"}
                size="sm"
                className="gap-2"
                isDisabled={!assemblyImage}
                onClick={() => setSelected("assy")}
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
                Completed assy
              </Button>
            </div>
          </div>

          {/* Current step */}
          <div className="flex min-h-0 grow-[3] basis-0 flex-col gap-3 overflow-y-auto p-6">
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
                    dangerouslySetInnerHTML={{ __html: stepDescriptionHtml }}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No steps defined for this operation.
              </p>
            )}
          </div>
        </main>

        {/* ── SIDEBAR: materials, tools, NCRs, torque ── */}
        <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden bg-card border-l border-border">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

            {torqueParam ? (
              <SidebarSection title="Torque">
                <div className="flex items-baseline justify-between">
                  <span>
                    <span className="text-2xl font-bold">
                      {torqueParam.value}
                    </span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      Nm
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">±5%</span>
                </div>
              </SidebarSection>
            ) : parameters.length > 0 ? (
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
          <div className="flex shrink-0 items-stretch gap-2 border-t border-border p-3">
            {step && (
              <div className="flex-1">
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
              className="flex-1"
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
    </div>
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
    <div className="flex h-full items-center gap-2 border-l border-border px-4">
      <span className="flex flex-col items-end leading-none">
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
          size="sm"
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
        scrollable ? "min-h-0 flex-1" : "shrink-0"
      )}
    >
      <Separator />
      <h3 className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div
        className={cn(
          "px-3.5 pb-2.5",
          scrollable && "min-h-0 flex-1 overflow-y-auto"
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
  const required = material.estimatedQuantity ?? material.quantity ?? 0;
  const issued = material.quantityIssued ?? 0;
  const fullyIssued = required > 0 && issued >= required;
  const partiallyIssued = issued > 0 && !fullyIssued;
  const isTracked =
    material.requiresSerialTracking || material.requiresBatchTracking;

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
          <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500">
            <LuCheck className="size-2.5 text-white" />
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
        {onIssue && (
          <button
            type="button"
            aria-label={isTracked ? "Scan material" : "Issue material"}
            onClick={onIssue}
            className="ml-0.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {isTracked ? (
              <LuQrCode className="size-3" />
            ) : (
              <LuGitBranchPlus className="size-3" />
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
  const busy = fetcher.state !== "idle";
  const [inputValue, setInputValue] = useState("");

  // Find the existing record for this unit (if done)
  const record = (step.jobOperationStepRecord ?? []).find(
    (r) => r.index === activeIndex
  );

  const type = step.type ?? "Task";

  // Undo: delete the record so step can be re-done
  function handleUndo() {
    if (!record) return;
    fetcher.submit(null, {
      method: "post",
      action: path.to.recordDelete(record.id)
    });
  }

  // Submit a completion record
  function submitRecord(extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append("jobOperationStepId", step.id);
    fd.append("index", String(activeIndex));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
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

    return (
      <div className="flex h-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
        <LuCheck className="size-4 shrink-0 text-emerald-500" />
        <span className="flex-1 text-sm text-emerald-600 dark:text-emerald-400">
          {recordedDisplay ? `Recorded: ${recordedDisplay}` : "Completed"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          isIcon
          aria-label="Undo"
          isLoading={busy}
          onClick={handleUndo}
        >
          <LuUndo2 className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  // ── Not done: show type-appropriate input ──

  // Task / Inspection → single "Mark done" button
  if (type === "Task" || type === "Inspection") {
    return (
      <Button
        variant="primary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={busy}
        className="w-full"
        onClick={() => submitRecord()}
      >
        Mark done
      </Button>
    );
  }

  // Checkbox → toggle-style button
  if (type === "Checkbox") {
    return (
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          isLoading={busy}
          className="flex-1"
          onClick={() => submitRecord({ booleanValue: "true" })}
        >
          ✓ Pass
        </Button>
        <Button
          variant="outline"
          size="sm"
          isLoading={busy}
          className="flex-1"
          onClick={() => submitRecord({ booleanValue: "false" })}
        >
          ✗ Fail
        </Button>
      </div>
    );
  }

  // Measurement → number input + UOM
  if (type === "Measurement") {
    const hint =
      step.minValue != null && step.maxValue != null
        ? `${step.minValue} – ${step.maxValue} ${step.unitOfMeasureCode ?? ""}`
        : (step.unitOfMeasureCode ?? "");
    return (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            placeholder={hint || "Value"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {step.unitOfMeasureCode && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {step.unitOfMeasureCode}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          isLoading={busy}
          isDisabled={!inputValue}
          onClick={() => {
            submitRecord({ numericValue: inputValue });
            setInputValue("");
          }}
        >
          Record
        </Button>
      </div>
    );
  }

  // List → native select
  if (type === "List" && step.listValues?.length) {
    return (
      <div className="flex gap-2">
        <select
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select…</option>
          {step.listValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          size="sm"
          isLoading={busy}
          isDisabled={!inputValue}
          onClick={() => {
            submitRecord({ value: inputValue });
            setInputValue("");
          }}
        >
          Record
        </Button>
      </div>
    );
  }

  // Value / Person / Timestamp / fallback → text/date input
  const inputType = type === "Timestamp" ? "datetime-local" : "text";
  const placeholder =
    type === "Person"
      ? "Name or ID…"
      : type === "Timestamp"
        ? undefined
        : "Enter value…";

  return (
    <div className="flex gap-2">
      <input
        type={inputType}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <Button
        variant="primary"
        size="sm"
        isLoading={busy}
        isDisabled={!inputValue}
        onClick={() => {
          const field: Record<string, string> =
            type === "Person"
              ? { userValue: inputValue }
              : { value: inputValue };
          submitRecord(field);
          setInputValue("");
        }}
      >
        Record
      </Button>
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
