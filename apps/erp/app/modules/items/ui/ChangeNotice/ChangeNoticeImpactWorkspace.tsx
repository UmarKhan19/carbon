import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps, ReactNode } from "react";
import {
  LuChevronRight,
  LuExternalLink,
  LuRefreshCw,
  LuTriangle
} from "react-icons/lu";
import { Link } from "react-router";
import { EmployeeAvatar } from "~/components";
import type {
  ChangeNotice,
  ChangeNoticeImpactCandidate,
  ChangeNoticeImpactCoverage,
  ChangeNoticeImpactDecisionStatus,
  ChangeNoticeImpactNoActionReasonCode,
  ChangeNoticeImpactTaskLink,
  ChangeNoticeImpactWorkspaceReadModel,
  ChangeNoticeImpactWorkspaceSnapshot
} from "~/modules/items";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import ChangeNoticeStatus from "./ChangeNoticeStatus";

const CURRENT_EXPOSURE = "Current operational exposure";
const HISTORICAL_REFERENCE = "Historical reference";
const NO_LONGER_IN_SCOPE = "No longer in current scope";

type WorkspaceProps = {
  id: string;
  changeNotice: ChangeNotice | null;
  data: ChangeNoticeImpactWorkspaceReadModel;
};

type Candidate = ChangeNoticeImpactWorkspaceReadModel["candidates"][number];

type Group = {
  key: string;
  label: string;
  parent: Candidate["parent"];
  candidates: Candidate[];
};

function formatQuantity(
  value: number,
  unit: string | null | undefined,
  locale: string
) {
  const formatted = value.toLocaleString(locale, {
    maximumFractionDigits: 6
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatImpactDate(value: string | null | undefined, locale: string) {
  return value ? formatDate(value, undefined, locale) : "—";
}

function domainLabel(targetType: Candidate["targetType"]): ReactNode {
  switch (targetType) {
    case "purchaseOrderLine":
      return <Trans>Purchase Order line</Trans>;
    case "job":
      return <Trans>Producing Job</Trans>;
    case "jobMaterial":
      return <Trans>Job Material</Trans>;
  }
}

function ParentStatus({
  parent
}: {
  parent: NonNullable<Candidate["parent"]>;
}) {
  if (parent.type === "purchaseOrder") {
    return (
      <PurchasingStatus
        status={
          parent.status as ComponentProps<typeof PurchasingStatus>["status"]
        }
      />
    );
  }

  return (
    <JobStatus
      status={parent.status as ComponentProps<typeof JobStatus>["status"]}
    />
  );
}

function decisionLabel(
  status: "Unassessed" | ChangeNoticeImpactDecisionStatus
): ReactNode {
  switch (status) {
    case "Unassessed":
      return <Trans>Unassessed</Trans>;
    case "No action required":
      return <Trans>No action required</Trans>;
    case "Action required":
      return <Trans>Action required</Trans>;
    case "Resolved":
      return <Trans>Resolved</Trans>;
    default:
      return status;
  }
}

function taskStatusLabel(status: ChangeNoticeImpactTaskLink["status"]) {
  switch (status) {
    case "Pending":
      return <Trans>Pending</Trans>;
    case "In Progress":
      return <Trans>In Progress</Trans>;
    case "Completed":
      return <Trans>Completed</Trans>;
    case "Skipped":
      return <Trans>Skipped</Trans>;
  }
}

function exposureLabel(
  classification: ChangeNoticeImpactCandidate["exposureClassification"]
) {
  switch (classification) {
    case CURRENT_EXPOSURE:
      return <Trans>Current operational exposure</Trans>;
    case HISTORICAL_REFERENCE:
      return <Trans>Historical reference</Trans>;
    case NO_LONGER_IN_SCOPE:
      return <Trans>No longer in current scope</Trans>;
    default:
      return null;
  }
}

function noActionReasonLabel(reason: ChangeNoticeImpactNoActionReasonCode) {
  switch (reason) {
    case "Outside effectivity":
      return <Trans>Outside effectivity</Trans>;
    case "Not affected after review":
      return <Trans>Not affected after review</Trans>;
    case "No purchasing intervention remains":
      return <Trans>No purchasing intervention remains</Trans>;
  }
}

function stateBadge(
  candidate: Candidate,
  coverageStatus: ChangeNoticeImpactCoverage["status"]
) {
  const status = candidate.decision?.status;
  const isCurrentUnassessed =
    coverageStatus === "complete" &&
    status === undefined &&
    candidate.sourceAvailability === "Present" &&
    candidate.exposureClassification === CURRENT_EXPOSURE;
  if (!status && !isCurrentUnassessed) return null;

  return (
    <Badge variant="outline" className="whitespace-nowrap">
      {decisionLabel(status ?? "Unassessed")}
    </Badge>
  );
}

function conditionBadges(candidate: Candidate) {
  const badges: ReactNode[] = [];
  if (candidate.exposureClassification !== CURRENT_EXPOSURE) {
    const label = exposureLabel(candidate.exposureClassification);
    if (label) {
      badges.push(
        <Badge key="exposure" variant="outline" className="whitespace-nowrap">
          {label}
        </Badge>
      );
    }
  }
  if (candidate.sourceAvailability !== "Present") {
    badges.push(
      <Badge
        key="availability"
        variant="outline"
        className="whitespace-nowrap border-amber-500/50 text-amber-700 dark:text-amber-300"
      >
        {candidate.sourceAvailability === "Source deleted" ? (
          <Trans>Source deleted</Trans>
        ) : candidate.sourceAvailability === "Restricted" ? (
          <Trans>Restricted</Trans>
        ) : (
          <Trans>Unavailable</Trans>
        )}
      </Badge>
    );
  }
  if (candidate.freshness === "Changed since assessment") {
    badges.push(
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-orange-500/50 text-orange-700 dark:text-orange-300"
      >
        <Trans>Changed since assessment</Trans>
      </Badge>
    );
  } else if (candidate.freshness === "Unknown") {
    badges.push(
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-amber-500/50 text-amber-700 dark:text-amber-300"
      >
        <Trans>Freshness unavailable</Trans>
      </Badge>
    );
  }
  return badges;
}

function sourceLink(candidate: Candidate) {
  if (!candidate.parent || candidate.sourceAvailability !== "Present") {
    return null;
  }
  const href =
    candidate.targetType === "purchaseOrderLine"
      ? path.to.purchaseOrderLine(candidate.parent.id, candidate.targetId)
      : candidate.targetType === "job"
        ? path.to.job(candidate.parent.id)
        : path.to.jobMaterials(candidate.parent.id);
  return (
    <Link
      to={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
    >
      <LuExternalLink className="size-3" />
      <Trans>Open source</Trans>
    </Link>
  );
}

function SnapshotFacts({
  candidate,
  snapshot = candidate.currentSnapshot,
  emptyMessage
}: {
  candidate: Candidate;
  snapshot?: ChangeNoticeImpactWorkspaceSnapshot | null;
  emptyMessage?: ReactNode;
}) {
  const { locale } = useLocale();
  if (!snapshot) {
    return (
      <span className="text-xs italic text-muted-foreground">
        {emptyMessage ??
          (candidate.sourceAvailability === "Unavailable" ? (
            <Trans>Current source facts are unavailable.</Trans>
          ) : (
            <Trans>
              No current snapshot is needed for this historical reference.
            </Trans>
          ))}
      </span>
    );
  }

  if (
    candidate.targetType === "purchaseOrderLine" &&
    snapshot.schema === "PO_LINE_SNAPSHOT_V1"
  ) {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Ordered</Trans>}
          value={formatQuantity(
            snapshot.orderedQuantity,
            snapshot.purchaseUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Received</Trans>}
          value={formatQuantity(
            snapshot.receivedQuantity,
            snapshot.inventoryUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.inventoryUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Promised</Trans>}
          value={formatImpactDate(snapshot.promisedDate, locale)}
        />
        <Fact
          label={<Trans>Required</Trans>}
          value={formatImpactDate(snapshot.requiredDate, locale)}
        />
        <Fact
          label={<Trans>PO status</Trans>}
          value={snapshot.purchaseOrderStatus}
        />
        <Fact
          label={<Trans>Conversion</Trans>}
          value={`${formatQuantity(snapshot.conversionFactor, null, locale)} ${snapshot.purchaseUnitOfMeasureCode ?? ""} → ${snapshot.inventoryUnitOfMeasureCode ?? ""}`}
        />
        <Fact
          label={<Trans>Receipt complete</Trans>}
          value={
            snapshot.receivedComplete ? <Trans>Yes</Trans> : <Trans>No</Trans>
          }
        />
      </div>
    );
  }

  if (candidate.targetType === "job" && snapshot.schema === "JOB_SNAPSHOT_V1") {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Planned</Trans>}
          value={formatQuantity(
            snapshot.plannedQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Completed</Trans>}
          value={formatQuantity(
            snapshot.completedQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Due</Trans>}
          value={formatImpactDate(snapshot.dueDate, locale)}
        />
        <Fact label={<Trans>Job status</Trans>} value={snapshot.status} />
        <Fact
          label={<Trans>Shipped</Trans>}
          value={formatQuantity(
            snapshot.quantityShipped,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Received to inventory</Trans>}
          value={formatQuantity(
            snapshot.quantityReceivedToInventory,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Method</Trans>}
          value={`V${snapshot.effectiveMethodVersion}`}
        />
      </div>
    );
  }

  if (
    candidate.targetType === "jobMaterial" &&
    snapshot.schema === "JOB_MATERIAL_SNAPSHOT_V1"
  ) {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Required</Trans>}
          value={formatQuantity(
            snapshot.requiredQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Issued</Trans>}
          value={
            snapshot.issuedQuantity === null
              ? "—"
              : formatQuantity(
                  snapshot.issuedQuantity,
                  snapshot.unitOfMeasureCode,
                  locale
                )
          }
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact label={<Trans>Job status</Trans>} value={snapshot.jobStatus} />
        <Fact label={<Trans>Method type</Trans>} value={snapshot.methodType} />
        <Fact
          label={<Trans>Batch tracking</Trans>}
          value={
            snapshot.requiresTracking.batch ? (
              <Trans>Yes</Trans>
            ) : (
              <Trans>No</Trans>
            )
          }
        />
        <Fact
          label={<Trans>Serial tracking</Trans>}
          value={
            snapshot.requiresTracking.serial ? (
              <Trans>Yes</Trans>
            ) : (
              <Trans>No</Trans>
            )
          }
        />
      </div>
    );
  }

  return (
    <span className="text-xs italic text-muted-foreground">
      <Trans>Current source facts are unavailable.</Trans>
    </span>
  );
}

function Fact({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function provenanceLabel(label: string | null): ReactNode {
  return label ?? <Trans>Affected item</Trans>;
}

function Provenance({ candidate }: { candidate: Candidate }) {
  if (candidate.provenance.length === 0) return null;
  return (
    <details className="group rounded-md border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Trans>Provenance</Trans>
      </summary>
      <div className="mt-2 space-y-2 pl-4">
        {candidate.currentProvenance.length > 0 && (
          <div>
            <div className="text-muted-foreground">
              <Trans>Current cause</Trans>
            </div>
            {candidate.currentProvenance.map((cause) => (
              <div key={`${cause.affectedItemId}-current`}>
                {provenanceLabel(cause.affectedItemLabel)}
              </div>
            ))}
          </div>
        )}
        {candidate.historicalProvenance.length > 0 && (
          <div>
            <div className="text-muted-foreground">
              <Trans>Historical causes</Trans>
            </div>
            {candidate.historicalProvenance.map((cause, index) => (
              <div
                key={`${cause.affectedItemId}-${cause.affectedItemSourceId}-${index}`}
              >
                <span>{provenanceLabel(cause.affectedItemLabel)}</span>
                {cause.endedReason && (
                  <span className="text-muted-foreground">
                    {` — ${cause.endedReason}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function DecisionSummary({ candidate }: { candidate: Candidate }) {
  const decision = candidate.decision;
  if (!decision) return null;

  return (
    <div className="space-y-1 text-xs">
      {decision.noActionReasonCode && (
        <div>
          <span className="text-muted-foreground">
            <Trans>No-action reason</Trans>:
          </span>{" "}
          {noActionReasonLabel(decision.noActionReasonCode)}
        </div>
      )}
      {decision.rationale && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Rationale</Trans>:
          </span>{" "}
          {decision.rationale}
        </div>
      )}
      {decision.resolutionNote && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Resolution note</Trans>:
          </span>{" "}
          {decision.resolutionNote}
        </div>
      )}
    </div>
  );
}

function AssessmentSnapshot({ candidate }: { candidate: Candidate }) {
  const snapshot = candidate.decision?.persistedSnapshot;
  if (!snapshot) return null;

  return (
    <details className="group rounded-md border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {candidate.freshness === "Changed since assessment" ? (
          <Trans>Assessment snapshot · changed</Trans>
        ) : (
          <Trans>Assessment snapshot</Trans>
        )}
      </summary>
      <div className="mt-2">
        <SnapshotFacts
          candidate={candidate}
          snapshot={snapshot}
          emptyMessage={
            <Trans>Stored assessment snapshot is unavailable.</Trans>
          }
        />
      </div>
    </details>
  );
}

function LinkedTasks({ tasks }: { tasks: ChangeNoticeImpactTaskLink[] }) {
  const { locale } = useLocale();
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-muted-foreground">
        <Trans>Linked tasks</Trans>
      </div>
      {tasks.map((task) => (
        <div
          key={`${task.decisionId}-${task.actionTaskId}`}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="min-w-0 truncate">
            {task.name ?? <Trans>Unnamed task</Trans>}
          </span>
          <Badge variant="outline" className="whitespace-nowrap">
            {taskStatusLabel(task.status)}
          </Badge>
          {task.assignee ? (
            <EmployeeAvatar employeeId={task.assignee} size="xxs" />
          ) : (
            <span className="text-muted-foreground">
              <Trans>Unassigned</Trans>
            </span>
          )}
          {task.dueDate && (
            <span className="text-muted-foreground">
              <Trans>Due</Trans> {formatImpactDate(task.dueDate, locale)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ImpactRow({
  candidate,
  coverageStatus
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
}) {
  const itemLabel = candidate.item?.readableIdWithRevision ??
    candidate.item?.readableId ?? <Trans>Item details unavailable</Trans>;
  const badges = conditionBadges(candidate);

  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {domainLabel(candidate.targetType)}
            </span>
            {stateBadge(candidate, coverageStatus)}
            {badges}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {candidate.parent && (
              <span className="inline-flex items-center gap-1">
                <span>{candidate.parent.readableId}</span>
                <ParentStatus parent={candidate.parent} />
              </span>
            )}
            {candidate.parent?.type === "purchaseOrder" &&
              candidate.parent.supplierName && (
                <span>
                  <Trans>Supplier</Trans>: {candidate.parent.supplierName}
                </span>
              )}
            <span>{itemLabel}</span>
          </div>
        </div>
        {sourceLink(candidate)}
      </div>
      <SnapshotFacts candidate={candidate} />
      {candidate.unavailableReason && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          {candidate.unavailableReason}
        </div>
      )}
      <DecisionSummary candidate={candidate} />
      <AssessmentSnapshot candidate={candidate} />
      <Provenance candidate={candidate} />
      <LinkedTasks tasks={candidate.taskLinks} />
    </div>
  );
}

function groupCandidates(candidates: Candidate[]): Group[] {
  const groups = new Map<string, Group>();
  for (const candidate of candidates) {
    const documentType =
      candidate.targetType === "purchaseOrderLine" ? "purchaseOrder" : "job";
    const key = candidate.parent
      ? `${documentType}-${candidate.parent.id}`
      : `missing-${candidate.targetType}-${candidate.targetId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    groups.set(key, {
      key,
      label: candidate.parent?.readableId ?? "",
      parent: candidate.parent,
      candidates: [candidate]
    });
  }
  return [...groups.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function DocumentGroups({
  candidates,
  emptyMessage,
  coverage
}: {
  candidates: Candidate[];
  emptyMessage: ReactNode;
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
}) {
  const groups = groupCandidates(candidates);
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                {group.label || <Trans>Source record unavailable</Trans>}
              </CardTitle>
              {group.parent && (
                <span className="text-xs text-muted-foreground">
                  <ParentStatus parent={group.parent} />
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {group.candidates.map((candidate) => (
              <ImpactRow
                key={`${candidate.targetType}-${candidate.targetId}`}
                candidate={candidate}
                coverageStatus={coverage[candidate.targetType].status}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CoverageNotice({
  label,
  coverage
}: {
  label: ReactNode;
  coverage: ChangeNoticeImpactCoverage;
}) {
  if (coverage.status === "complete") return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
      <LuTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {coverage.status === "restricted" ? (
            <Trans>
              This source domain is restricted for your current permissions. No
              target identities or source facts are shown.
            </Trans>
          ) : coverage.status === "partial" ? (
            <Trans>
              Coverage is partial. Counts and source-deletion conclusions are
              withheld where the scan could not be completed.
            </Trans>
          ) : (
            <Trans>
              Coverage failed. This is not an empty or safe result; refresh
              after the source is available.
            </Trans>
          )}
        </div>
        {coverage.errorMessage && (
          <div className="mt-1 text-xs text-muted-foreground">
            {coverage.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function CoverageCount({ value }: { value: number | null }) {
  const { locale } = useLocale();
  return value === null ? (
    <Trans>Unavailable</Trans>
  ) : (
    value.toLocaleString(locale)
  );
}

function CoverageSummary({
  data
}: {
  data: ChangeNoticeImpactWorkspaceReadModel;
}) {
  const domains = [
    {
      key: "purchaseOrderLine" as const,
      label: <Trans>Purchase Order lines</Trans>,
      coverage: data.coverage.purchaseOrderLine
    },
    {
      key: "job" as const,
      label: <Trans>Producing Jobs</Trans>,
      coverage: data.coverage.job
    },
    {
      key: "jobMaterial" as const,
      label: <Trans>Job Materials</Trans>,
      coverage: data.coverage.jobMaterial
    }
  ];
  return (
    <section aria-labelledby="impact-coverage-heading" className="w-full">
      <h2 id="impact-coverage-heading" className="sr-only">
        <Trans>Assessment coverage</Trans>
      </h2>
      <div className="grid gap-2 md:grid-cols-3">
        {domains.map(({ key, label, coverage }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">
                  <Trans>Current</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.currentExposureCount} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  <Trans>Historical</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.historicalReferenceCount} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  <Trans>Unassessed</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.unassessedCount} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function isCurrent(candidate: Candidate) {
  return (
    candidate.sourceAvailability !== "Unavailable" &&
    candidate.exposureClassification === CURRENT_EXPOSURE
  );
}

function isHistorical(candidate: Candidate) {
  return (
    candidate.sourceAvailability !== "Unavailable" &&
    (candidate.exposureClassification === HISTORICAL_REFERENCE ||
      candidate.exposureClassification === NO_LONGER_IN_SCOPE ||
      candidate.sourceAvailability === "Source deleted")
  );
}

function isUnavailable(candidate: Candidate) {
  return (
    candidate.sourceAvailability === "Unavailable" ||
    (candidate.exposureClassification === null && !isHistorical(candidate))
  );
}

export default function ChangeNoticeImpactWorkspace({
  id,
  changeNotice,
  data
}: WorkspaceProps) {
  const currentCandidates = data.candidates.filter(isCurrent);
  const historicalCandidates = data.candidates.filter(isHistorical);
  const unavailableCandidates = data.candidates.filter(isUnavailable);
  const coverageHasWarning = [
    data.coverage.purchaseOrderLine,
    data.coverage.job,
    data.coverage.jobMaterial
  ].some((coverage) => coverage.status !== "complete");
  const taskCoverageHasWarning = data.taskCoverage.status !== "complete";
  const status = changeNotice?.status ?? data.changeNoticeStatus;

  return (
    <VStack spacing={4} className="mx-auto w-full max-w-[1400px] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={path.to.changeNoticeDetails(id)}
            className="mb-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <LuChevronRight className="size-3 rotate-180" />
            <Trans>Back to Change Notice</Trans>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">
              <Trans>Operational Impact</Trans>
            </h1>
            {status && <ChangeNoticeStatus status={status} />}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            <span>
              {changeNotice?.changeOrderId ?? <Trans>Change Notice</Trans>}
            </span>
            {changeNotice?.name && <span>· {changeNotice.name}</span>}
          </div>
          {status === "Done" && (
            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Trans>
                Done · Engineering released. Operational assessment remains
                available.
              </Trans>
            </div>
          )}
        </div>
        <Link
          to={path.to.changeNoticeImpact(id)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <LuRefreshCw className="size-3.5" />
          <Trans>Refresh</Trans>
        </Link>
      </div>

      {coverageHasWarning && (
        <div className="space-y-2">
          <CoverageNotice
            label={<Trans>Assessment coverage needs attention</Trans>}
            coverage={
              [
                data.coverage.purchaseOrderLine,
                data.coverage.job,
                data.coverage.jobMaterial
              ].find((coverage) => coverage.status !== "complete") ??
              data.coverage.purchaseOrderLine
            }
          />
          <div className="grid gap-2 md:grid-cols-3">
            <CoverageNotice
              label={<Trans>Purchase Order lines</Trans>}
              coverage={data.coverage.purchaseOrderLine}
            />
            <CoverageNotice
              label={<Trans>Producing Jobs</Trans>}
              coverage={data.coverage.job}
            />
            <CoverageNotice
              label={<Trans>Job Materials</Trans>}
              coverage={data.coverage.jobMaterial}
            />
          </div>
        </div>
      )}
      {taskCoverageHasWarning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Trans>
            Some linked task metadata is unavailable. Decision state is shown
            independently and has not been inferred from task status. Task
            details are omitted where linked-task coverage could not be read.
          </Trans>
        </div>
      )}

      <CoverageSummary data={data} />

      <section className="w-full space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            <Trans>Current operational exposure</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Supported purchasing and production targets that can receive an
              independent Impact assessment.
            </Trans>
          </p>
        </div>
        {currentCandidates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {coverageHasWarning ? (
              <Trans>No complete current result is available.</Trans>
            ) : (
              <Trans>No current operational exposure is available.</Trans>
            )}
          </div>
        ) : (
          <>
            <DocumentGroups
              candidates={currentCandidates.filter(
                (candidate) => candidate.targetType === "purchaseOrderLine"
              )}
              coverage={data.coverage}
              emptyMessage={
                <Trans>No Purchase Order lines are available.</Trans>
              }
            />
            <DocumentGroups
              candidates={currentCandidates.filter(
                (candidate) =>
                  candidate.targetType === "job" ||
                  candidate.targetType === "jobMaterial"
              )}
              coverage={data.coverage}
              emptyMessage={
                <Trans>No Jobs or Job Materials are available.</Trans>
              }
            />
          </>
        )}
      </section>

      <section className="w-full space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            <Trans>Historical references</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>
              These references remain traceable but do not create a new
              Unassessed obligation.
            </Trans>
          </p>
        </div>
        <DocumentGroups
          candidates={historicalCandidates}
          coverage={data.coverage}
          emptyMessage={
            coverageHasWarning ? (
              <Trans>Historical coverage is incomplete.</Trans>
            ) : (
              <Trans>No historical references are available.</Trans>
            )
          }
        />
      </section>

      {unavailableCandidates.length > 0 && (
        <section className="w-full space-y-3">
          <div>
            <h2 className="text-base font-semibold">
              <Trans>Unavailable source rows</Trans>
            </h2>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Source identities are retained only where they were authorized;
                decision-relevant facts are withheld until coverage is restored.
              </Trans>
            </p>
          </div>
          <DocumentGroups
            candidates={unavailableCandidates}
            coverage={data.coverage}
            emptyMessage={
              <Trans>No unavailable source rows are available.</Trans>
            }
          />
        </section>
      )}

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-sm">
            <Trans>Informational context only</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          <Trans>
            Receipts, inspections, sales, shipments, and other where-used
            records are outside the three supported Impact target contracts in
            this workspace. They are not loaded as Impact rows until dedicated
            source-aware context readers can report their own coverage. They do
            not contribute to assessment totals or offer decision controls here.
          </Trans>
        </CardContent>
      </Card>
    </VStack>
  );
}
