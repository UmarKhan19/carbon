import {
  Avatar,
  Badge,
  Button,
  cn,
  Input,
  Separator,
  Status
} from "@carbon/react";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuFlag,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router";
import ItemThumbnail from "~/components/ItemThumbnail";
import { useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

type Props = {
  operationId: string;
  job: { itemReadableIdWithRevision?: string | null } | null;
  operation: { description?: string | null } | null;
  thumbnailPath: string | null | undefined;
  trackedEntities: { id: string; readableId?: string | null }[];
  trackedEntityId: string | null;
  materials: { materials?: any[]; trackedInputs?: any[] } | null;
  procedure: { attributes: any[]; parameters: any[] };
  tools: {
    quantity: number;
    item: { id: string; name: string; type: string } | null;
  }[];
  ncrs: any[];
};

const FASTENER_KEYWORDS = [
  "bolt",
  "nut",
  "screw",
  "washer",
  "rivet",
  "pin",
  "stud",
  "hex",
  "fastener"
];
const isFastener = (name: string) =>
  FASTENER_KEYWORDS.some((kw) => name.toLowerCase().includes(kw));

// A jobOperationStep.description is a TipTap/ProseMirror doc ({type, content}),
// not a string — extract its plain text (including @mention labels) for display.
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

export function AssemblyView({
  job,
  operation,
  thumbnailPath,
  trackedEntities,
  trackedEntityId,
  materials,
  procedure,
  tools,
  ncrs
}: Props) {
  const user = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const steps = [...(procedure.attributes ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  const parameters = procedure.parameters ?? [];
  const currentStep = Math.max(
    0,
    Math.min(
      parseInt(searchParams.get("step") ?? "0"),
      Math.max(0, steps.length - 1)
    )
  );
  const step = steps[currentStep] ?? null;
  const stepNote = richTextToPlainText(step?.description);

  const rawMaterials: any[] = materials?.materials ?? [];
  const parts = rawMaterials.filter((m) => !isFastener(m.description ?? ""));
  const fasteners = rawMaterials.filter((m) => isFastener(m.description ?? ""));

  const torqueParam = parameters.find((p) =>
    p.key?.toLowerCase().includes("torque")
  );

  const currentEntityIndex = trackedEntityId
    ? Math.max(
        0,
        trackedEntities.findIndex((te) => te.id === trackedEntityId)
      )
    : 0;
  const isSerial = trackedEntities.length > 0;
  const prevEntity =
    currentEntityIndex > 0 ? trackedEntities[currentEntityIndex - 1] : null;
  const nextEntity =
    currentEntityIndex < trackedEntities.length - 1
      ? trackedEntities[currentEntityIndex + 1]
      : null;
  const currentEntity = trackedEntities[currentEntityIndex];

  function goToStep(n: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("step", String(n));
      return next;
    });
  }

  function navigateEntity(entity: { id: string }) {
    const url = new URL(window.location.href);
    url.searchParams.set("trackedEntityId", entity.id);
    navigate(url.pathname + url.search);
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const isLastStep = steps.length > 0 && currentStep >= steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border">
        <div className="flex h-full items-center border-r border-border px-5 text-base font-bold tracking-tight">
          {user.company.name}
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
                    key={i}
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

        <div className="flex h-full items-center border-l border-border px-5 text-sm font-medium tabular-nums">
          {formatElapsed(elapsed)}
        </div>

        <div className="flex h-full items-center border-l border-border px-4">
          <Button variant="outline" size="sm" leftIcon={<LuFlag />}>
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

      {/* ── STEP PROGRESS BAR ── */}
      {steps.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-3 bg-card border-b border-border px-5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {operation?.description ?? "Assembly"}
          </span>
          <div className="flex flex-1 gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to step ${i + 1}`}
                onClick={() => goToStep(i)}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < currentStep
                    ? "bg-emerald-500"
                    : i === currentStep
                      ? "bg-foreground"
                      : "bg-border"
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
        {/* ── LEFT: DIAGRAM + THUMBNAILS + INSTRUCTION ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Diagram canvas */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted">
            {thumbnailPath ? (
              <img
                src={getPrivateUrl(thumbnailPath)}
                alt="Assembly diagram"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <ItemThumbnail size="xl" type="Part" />
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-lg italic text-muted-foreground/60">
              {job?.itemReadableIdWithRevision}
              {operation?.description ? ` — ${operation.description}` : ""}
            </div>
          </div>

          {/* Thumbnail strip */}
          <div className="flex h-[76px] shrink-0 items-center gap-2 bg-card border-t border-border px-3.5 py-2.5">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                className={cn(
                  "flex h-14 w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-md border-2",
                  i === 0 ? "border-foreground" : "border-transparent"
                )}
              >
                <ItemThumbnail
                  thumbnailPath={thumbnailPath}
                  size="lg"
                  type="Part"
                />
              </button>
            ))}
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="gap-2">
              <ItemThumbnail
                thumbnailPath={thumbnailPath}
                size="sm"
                type="Part"
              />
              Completed assy
            </Button>
          </div>

          {/* Instruction bar */}
          <div className="flex min-h-[88px] shrink-0 items-center gap-3 bg-card border-t border-border py-3 pl-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
              {steps.length > 0 ? currentStep + 1 : "—"}
            </div>
            <Badge variant="secondary" className="shrink-0 normal-case">
              {operation?.description ?? "Assembly"}
            </Badge>
            <p className="line-clamp-3 flex-1 text-sm leading-relaxed">
              {step?.name ??
                operation?.description ??
                "No steps defined for this operation."}
            </p>
            {stepNote ? (
              <div className="mr-4 flex max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-400">
                <LuTriangleAlert className="size-3.5 shrink-0" />
                <span className="line-clamp-2">{stepNote}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="flex w-[340px] shrink-0 flex-col bg-card border-l border-border">
          <div className="flex flex-1 flex-col overflow-hidden">
            {parts.length > 0 && (
              <SidebarSection title="Parts" scrollable>
                {parts.map((m, i) => (
                  <MaterialRow key={i} material={m} />
                ))}
              </SidebarSection>
            )}

            {fasteners.length > 0 && (
              <SidebarSection title="Fasteners" scrollable>
                {fasteners.map((m, i) => (
                  <MaterialRow key={i} material={m} />
                ))}
              </SidebarSection>
            )}

            {parts.length === 0 && fasteners.length === 0 && (
              <SidebarSection title="Materials">
                <p className="text-xs text-muted-foreground">
                  No materials assigned
                </p>
              </SidebarSection>
            )}

            {tools.length > 0 && (
              <SidebarSection title="Tools" scrollable>
                {tools.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
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

            {ncrs.length > 0 && (
              <SidebarSection title="Open NCRs">
                {ncrs.map((ncr, i) => {
                  const nc = ncr.nonConformance;
                  const isClosed = nc?.status === "Closed";
                  const readableId =
                    nc?.nonConformanceId ?? ncr.nonConformanceId;
                  return (
                    <div key={i} className="flex items-center gap-2 py-1">
                      <Status color={isClosed ? "green" : "red"}>
                        {readableId}
                      </Status>
                      <div className="flex-1" />
                      <div className="size-5 shrink-0 rounded border border-border" />
                    </div>
                  );
                })}
              </SidebarSection>
            )}

            {isSerial && (
              <SidebarSection title="Serial Numbers">
                <div className="flex items-center gap-2">
                  <Input
                    isReadOnly
                    size="sm"
                    value={currentEntity?.readableId ?? "—"}
                    className="flex-1 font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    Issue S/N to assy
                  </Button>
                </div>
              </SidebarSection>
            )}

            {torqueParam ? (
              <SidebarSection title="Torque">
                <div className="flex items-baseline justify-between">
                  <span>
                    <span className="text-3xl font-bold">
                      {torqueParam.value}
                    </span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      Nm
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">±5%</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input placeholder="Achieved" size="sm" className="flex-1" />
                  <span className="text-xs text-muted-foreground">Nm</span>
                  <Button variant="primary" size="sm">
                    Log
                  </Button>
                </div>
              </SidebarSection>
            ) : parameters.length > 0 ? (
              <SidebarSection title="Parameters">
                {parameters.map((p, i) => (
                  <div key={i} className="flex justify-between py-0.5">
                    <span className="text-xs text-muted-foreground">
                      {p.key}
                    </span>
                    <span className="text-xs font-medium">{p.value}</span>
                  </div>
                ))}
              </SidebarSection>
            ) : null}
          </div>

          <Button
            variant="primary"
            size="lg"
            className="h-14 w-full shrink-0 rounded-none text-base"
            isDisabled={isLastStep}
            rightIcon={<LuChevronRight />}
            onClick={() =>
              steps.length > 0 && !isLastStep
                ? goToStep(currentStep + 1)
                : undefined
            }
          >
            Next
          </Button>
        </aside>
      </div>
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

function MaterialRow({ material }: { material: any }) {
  const qty = material.estimatedQuantity ?? material.quantity ?? 0;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[72px] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
        {material.itemReadableId}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-xs">{material.description}</span>
        {material.requiresSerialTracking && <Badge variant="blue">S/N</Badge>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">×{qty}</span>
    </div>
  );
}
