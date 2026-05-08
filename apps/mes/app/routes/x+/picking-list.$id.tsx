import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  cn,
  Heading,
  IconButton,
  Input,
  SidebarTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuHash,
  LuMapPin,
  LuPackage,
  LuQrCode,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { getPickingListForOperator } from "~/services/inventory.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await getPickingListForOperator(client, id, companyId);

  if (result.error || !result.data) {
    throw redirect(
      path.to.pickingLists,
      await flash(request, error(result.error, "Picking list not found"))
    );
  }

  return result.data;
}

type Line = {
  id: string;
  itemId: string | null;
  storageUnitId: string | null;
  destinationStorageUnitId: string | null;
  estimatedQuantity: number | null;
  adjustedQuantity: number | null;
  pickedQuantity: number | null;
  pickedTrackedEntityId: string | null;
  outstandingQuantity?: number | null;
  unitOfMeasureCode: string | null;
  requiresBatchTracking: boolean | null;
  requiresSerialTracking: boolean | null;
  item: {
    id: string;
    name: string | null;
    readableId: string | null;
  } | null;
  storageUnit: { id: string; name: string | null } | null;
  destinationStorageUnit: { id: string; name: string | null } | null;
};

export default function PickingListPickRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { pickingList, lines } = useLoaderData<typeof loader>() as {
    pickingList: any;
    lines: Line[];
  };
  const navigate = useNavigate();
  const pickFetcher = useFetcher();

  const isEditable = ["Released", "In Progress"].includes(pickingList.status);
  const totalLines = lines.length;
  const pickedCount = lines.filter(
    (l) => Number(l.pickedQuantity ?? 0) > 0
  ).length;
  const allPicked = pickedCount === totalLines && totalLines > 0;
  const isOverdue =
    pickingList.dueDate != null &&
    new Date(pickingList.dueDate).getTime() < Date.now() &&
    !["Confirmed", "Cancelled"].includes(pickingList.status);

  // Pick the first not-yet-fully-picked line as the focused step.
  const defaultIndex = useMemo(() => {
    const idx = lines.findIndex((l) => {
      const required = Number(l.adjustedQuantity ?? l.estimatedQuantity ?? 0);
      const picked = Number(l.pickedQuantity ?? 0);
      return picked < required;
    });
    return idx >= 0 ? idx : 0;
  }, [lines]);

  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const safeIndex = Math.min(Math.max(activeIndex, 0), totalLines - 1);
  const currentLine = lines[safeIndex];

  const onPickQty = (line: Line, qty: number) => {
    pickFetcher.submit(
      { pickingListLineId: line.id, pickedQuantity: String(qty) },
      { method: "post", action: path.to.pickingListPick(id) }
    );
  };

  const onScan = (line: Line) => {
    navigate(path.to.pickingListScan(id, line.id));
  };

  const onConfirm = () => {
    navigate(path.to.pickingListConfirm(id));
  };

  return (
    <div className="flex flex-col flex-1 bg-background">
      {/* Top header */}
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-background px-3">
        <SidebarTrigger />
        <IconButton
          aria-label={t`Back`}
          variant="ghost"
          icon={<LuArrowLeft />}
          asChild
        >
          <Link to={path.to.pickingLists} />
        </IconButton>
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Heading size="h4" className="tabular-nums">
              {pickingList.pickingListId}
            </Heading>
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {[
              pickingList.job?.jobId,
              pickingList.job?.item?.name ?? pickingList.job?.item?.readableId,
              pickingList.location?.name
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isOverdue && (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-medium uppercase text-red-500">
              <LuTriangleAlert className="h-3 w-3" />
              <Trans>Overdue</Trans>
            </span>
          )}
          <StatusBadge status={pickingList.status} />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Walking order sidebar */}
        <aside className="w-64 shrink-0 border-r bg-card overflow-y-auto hidden md:block">
          <div className="px-3 py-2 border-b">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <Trans>Walking order</Trans>
            </span>
          </div>
          <ul>
            {lines.map((line, idx) => {
              const required = Number(
                line.adjustedQuantity ?? line.estimatedQuantity ?? 0
              );
              const picked = Number(line.pickedQuantity ?? 0);
              const isComplete = required > 0 && picked >= required;
              const isCurrent = idx === safeIndex;
              return (
                <li key={line.id}>
                  <button
                    type="button"
                    onClick={() => setActiveIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors border-l-2",
                      isCurrent
                        ? "border-blue-500 bg-blue-500/10"
                        : isComplete
                          ? "border-emerald-500/60 hover:bg-muted/40"
                          : "border-transparent hover:bg-muted/40"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0",
                        isComplete
                          ? "bg-emerald-500 text-white"
                          : isCurrent
                            ? "bg-blue-500 text-white"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {isComplete ? (
                        <LuCheck className="h-3.5 w-3.5" />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm truncate">
                        {line.item?.name ?? line.item?.readableId ?? "—"}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums truncate">
                        {line.storageUnit?.name ?? <Trans>unassigned</Trans>}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {picked}/{required || 0}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {totalLines === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <LuPackage className="h-8 w-8 text-muted-foreground" />
              <span className="text-xs uppercase font-mono text-muted-foreground">
                <Trans>This picking list has no lines</Trans>
              </span>
            </div>
          ) : currentLine ? (
            <CurrentLinePanel
              line={currentLine}
              stepIndex={safeIndex}
              totalSteps={totalLines}
              isEditable={isEditable}
              onPickQty={onPickQty}
              onScan={onScan}
              onPrev={() => setActiveIndex((i) => Math.max(0, i - 1))}
              onNext={() =>
                setActiveIndex((i) => Math.min(totalLines - 1, i + 1))
              }
              isFirst={safeIndex === 0}
              isLast={safeIndex === totalLines - 1}
            />
          ) : null}
        </main>
      </div>

      {/* Bottom action bar */}
      <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-card px-4 py-2">
        <div className="flex items-center gap-3 min-w-0 flex-1 max-w-md">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <Trans>Lines</Trans>
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {pickedCount}/{totalLines}
          </span>
          <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                allPicked ? "bg-emerald-500" : "bg-blue-500"
              )}
              style={{
                width: `${
                  totalLines > 0 ? (pickedCount / totalLines) * 100 : 0
                }%`
              }}
            />
          </div>
        </div>
        {isEditable && (
          <Button
            isDisabled={!allPicked}
            leftIcon={<LuCircleCheck />}
            onClick={onConfirm}
          >
            <Trans>Confirm picking list</Trans>
          </Button>
        )}
      </footer>

      <Outlet />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "In Progress"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
      : status === "Released"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : status === "Confirmed"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : status === "Cancelled"
            ? "border-muted-foreground/40 bg-muted/40 text-muted-foreground"
            : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        classes
      )}
    >
      {status}
    </span>
  );
}

function CurrentLinePanel({
  line,
  stepIndex,
  totalSteps,
  isEditable,
  onPickQty,
  onScan,
  onPrev,
  onNext,
  isFirst,
  isLast
}: {
  line: Line;
  stepIndex: number;
  totalSteps: number;
  isEditable: boolean;
  onPickQty: (line: Line, qty: number) => void;
  onScan: (line: Line) => void;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { t } = useLingui();
  const required = Number(line.adjustedQuantity ?? line.estimatedQuantity ?? 0);
  const picked = Number(line.pickedQuantity ?? 0);
  const need = Math.max(required - picked, 0);
  const isTracked = !!(
    line.requiresBatchTracking || line.requiresSerialTracking
  );
  const isPicked = picked > 0;
  const [manualQty, setManualQty] = useState(String(picked || ""));
  const [showManual, setShowManual] = useState(!isTracked);

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto">
      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Step banner */}
        <div className="flex items-center justify-between gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-400">
            <LuCirclePlay className="h-3.5 w-3.5" />
            <Trans>
              Step {String(stepIndex + 1)} of {String(totalSteps)}
            </Trans>
          </span>
          {isTracked && (
            <span className="text-[10px] uppercase tracking-wider text-emerald-400/80">
              <Trans>Tracked · scan required</Trans>
            </span>
          )}
        </div>

        {/* Item card */}
        <div className="flex items-start justify-between gap-4 px-5 py-5">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted shrink-0">
              <LuPackage className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xl font-semibold leading-tight truncate">
                {line.item?.name ?? <Trans>Unnamed item</Trans>}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {line.item?.readableId ?? "—"}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <Trans>Need</Trans>
            </span>
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                need > 0 ? "text-amber-400" : "text-emerald-400"
              )}
            >
              {need || picked}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              <Trans>of</Trans> {required} {line.unitOfMeasureCode ?? ""}
            </span>
          </div>
        </div>

        {/* Pick from → Stage at */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-3 px-5 pb-4">
          <LocationCard
            label={<Trans>Pick from</Trans>}
            value={line.storageUnit?.name ?? t`Unassigned`}
          />
          <div className="hidden md:flex items-center justify-center text-muted-foreground">
            <LuArrowRight className="h-5 w-5" />
          </div>
          <LocationCard
            label={<Trans>Stage at</Trans>}
            value={line.destinationStorageUnit?.name ?? t`Unassigned`}
            tone="success"
          />
        </div>

        {/* Proposed entity badge — visible only when one is picked / proposed */}
        {line.pickedTrackedEntityId && (
          <div className="px-5 pb-3">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-mono text-muted-foreground">
              <LuHash className="h-3 w-3" />
              <span className="truncate max-w-[280px]">
                {line.pickedTrackedEntityId}
              </span>
              <span className="text-muted-foreground/70">
                <Trans>picked entity</Trans>
              </span>
            </span>
          </div>
        )}

        {/* Action buttons */}
        {isEditable && (
          <div className="px-5 pb-4">
            {isTracked && !showManual ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  leftIcon={<LuQrCode />}
                  onClick={() => onScan(line)}
                  className="h-16 bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  {line.pickedTrackedEntityId ? (
                    <Trans>Re-scan entity</Trans>
                  ) : (
                    <Trans>Scan entity</Trans>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  leftIcon={<LuHash />}
                  onClick={() => setShowManual(true)}
                  className="h-16"
                >
                  <Trans>Manual qty</Trans>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={manualQty}
                  type="number"
                  min={0}
                  step="any"
                  onChange={(e) => setManualQty(e.target.value)}
                  className="text-right text-lg flex-1 h-12"
                  placeholder={t`Quantity`}
                />
                <span className="text-xs text-muted-foreground">
                  {line.unitOfMeasureCode ?? ""}
                </span>
                <Button
                  size="lg"
                  leftIcon={<LuCheck />}
                  onClick={() => {
                    const n = parseFloat(manualQty);
                    if (!Number.isNaN(n)) onPickQty(line, n);
                  }}
                >
                  <Trans>Pick</Trans>
                </Button>
                {isTracked && (
                  <IconButton
                    aria-label={t`Switch to scan`}
                    icon={<LuQrCode />}
                    variant="ghost"
                    onClick={() => setShowManual(false)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom actions row */}
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40"
          >
            <LuChevronLeft className="h-4 w-4" />
            <Trans>Previous</Trans>
          </button>

          <div className="flex items-center gap-4">
            {isPicked && isEditable && (
              <button
                type="button"
                onClick={() => onPickQty(line, 0)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <LuUndo2 className="h-3.5 w-3.5" />
                <Trans>Unpick</Trans>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onNext}
            disabled={isLast}
            className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40"
          >
            <Trans>Skip</Trans>
            <LuChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {Number(line.outstandingQuantity ?? 0) > 0 && (
        <div className="mt-2 px-1 text-xs text-amber-500">
          <Trans>Outstanding:</Trans> {line.outstandingQuantity}{" "}
          {line.unitOfMeasureCode ?? ""}
        </div>
      )}
    </div>
  );
}

function LocationCard({
  label,
  value,
  tone
}: {
  label: React.ReactNode;
  value: string;
  tone?: "success";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <LuMapPin className="h-3 w-3" />
        {label}
      </div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums truncate",
          tone === "success" && "text-emerald-400"
        )}
      >
        {value}
      </div>
    </div>
  );
}
