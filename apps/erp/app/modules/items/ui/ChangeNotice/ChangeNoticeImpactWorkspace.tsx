import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronRight,
  LuExternalLink,
  LuHistory,
  LuRefreshCw,
  LuTriangle
} from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  Hidden,
  Select,
  Submit,
  TextArea,
  TextAreaControlled
} from "~/components/Form";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  type ChangeNotice,
  type ChangeNoticeImpactCandidate,
  type ChangeNoticeImpactCoverage,
  type ChangeNoticeImpactDecisionStatus,
  type ChangeNoticeImpactNoActionReasonCode,
  type ChangeNoticeImpactWorkspaceReadModel,
  changeNoticeImpactDecisionFormValidator,
  changeNoticeImpactDecisionStatuses,
  changeNoticeStageFlow
} from "~/modules/items";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import type { ChangeNoticeActionTask } from "../../types";
import {
  ChangeNoticeImpactFilterBar,
  filterChangeNoticeImpactCandidates,
  getImpactDecisionFilterValue,
  getImpactFilteredEmptyState,
  getImpactFilterValues,
  hasImpactDisplayFilters,
  hasIncompleteImpactTaskFilter
} from "./ChangeNoticeImpactFilters";
import { ChangeNoticeImpactHistory } from "./ChangeNoticeImpactHistory";
import { SnapshotFacts } from "./ChangeNoticeImpactSnapshotFacts";
import { ChangeNoticeImpactTasks } from "./ChangeNoticeImpactTasks";
import ChangeNoticeStatus from "./ChangeNoticeStatus";

const CURRENT_EXPOSURE = "Current operational exposure";
const HISTORICAL_REFERENCE = "Historical reference";
const NO_LONGER_IN_SCOPE = "No longer in current scope";

type WorkspaceProps = {
  id: string;
  changeNotice: ChangeNotice | null;
  data: ChangeNoticeImpactWorkspaceReadModel;
  actions: ChangeNoticeActionTask[];
};

type Candidate = ChangeNoticeImpactWorkspaceReadModel["candidates"][number];

type Group = {
  key: string;
  label: string;
  parent: Candidate["parent"];
  candidates: Candidate[];
};

export type ChangeNoticeImpactDecisionMode = "assess" | "reassess" | "resolve";

type ImpactResolutionBlock = "taskCoverage" | "nonTerminalTask" | null;

export type ChangeNoticeImpactDecisionControls = {
  assess: boolean;
  reassess: boolean;
  resolve: boolean;
  resolveBlock: ImpactResolutionBlock;
};

export function canViewChangeNoticeImpactHistory(
  candidate: Candidate
): boolean {
  return (
    candidate.decision !== null && candidate.sourceAvailability !== "Restricted"
  );
}

export function getChangeNoticeImpactDecisionStatusOptions(
  decision: Candidate["decision"]
): ChangeNoticeImpactDecisionStatus[] {
  // Resolved is a same-state reassessment option. New and open decisions use
  // the dedicated Resolve action for closure so it cannot bypass task gates.
  return decision?.status === "Resolved"
    ? [...changeNoticeImpactDecisionStatuses]
    : ["No action required", "Action required"];
}

export function getChangeNoticeImpactRationaleDefault({
  persistedStatus,
  selectedStatus,
  persistedRationale
}: {
  persistedStatus: ChangeNoticeImpactDecisionStatus | null;
  selectedStatus: ChangeNoticeImpactDecisionStatus;
  persistedRationale: string | null | undefined;
}): string {
  return persistedStatus === selectedStatus ? (persistedRationale ?? "") : "";
}

export function getChangeNoticeImpactDecisionControls({
  candidate,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
}): ChangeNoticeImpactDecisionControls {
  const decision = candidate.decision;
  const isCurrentAssessable =
    candidate.exposureClassification === CURRENT_EXPOSURE &&
    candidate.sourceAvailability === "Present" &&
    candidate.currentSnapshot !== null;
  const lifecycleAllowsNewWork =
    changeNoticeStatus !== undefined &&
    changeNoticeStatus !== null &&
    (changeNoticeStageFlow as readonly string[]).includes(changeNoticeStatus);
  const coverageComplete = coverageStatus === "complete";
  const canReassess =
    canUpdate &&
    decision !== null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork &&
    candidate.freshness !== "Unknown";
  const canAssess =
    canUpdate &&
    decision === null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork;

  const canResolveExisting =
    canUpdate &&
    decision?.status === "Action required" &&
    candidate.sourceAvailability !== "Restricted" &&
    (lifecycleAllowsNewWork || changeNoticeStatus === "Cancelled");
  const canResolveFirst =
    canUpdate &&
    decision === null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork;
  const canShowResolve = canResolveExisting || canResolveFirst;
  const hasNonTerminalTask = candidate.taskLinks.some(
    (task) => task.status !== "Completed" && task.status !== "Skipped"
  );

  return {
    assess: canAssess,
    reassess: canReassess,
    resolve: canShowResolve,
    resolveBlock: canResolveExisting
      ? taskCoverageStatus !== "complete"
        ? "taskCoverage"
        : hasNonTerminalTask
          ? "nonTerminalTask"
          : null
      : null
  };
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
): string | JSX.Element {
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

function noActionReasonLabel(
  reason: ChangeNoticeImpactNoActionReasonCode
): string | JSX.Element {
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
  const status = getImpactDecisionFilterValue(candidate, coverageStatus);
  if (!status) return null;

  return (
    <Badge variant="outline" className="whitespace-nowrap">
      {decisionLabel(status)}
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

type ImpactDecisionFetcherData =
  | { success: true; data: unknown }
  | { success: false; error?: { message: string }; conflict?: boolean };

type ImpactDecisionDrawerProps = {
  changeNoticeId: string;
  candidate: Candidate;
  mode: ChangeNoticeImpactDecisionMode;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
  onConflict: (message: string) => void;
};

function ImpactDecisionDrawer({
  changeNoticeId,
  candidate,
  mode,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  onClose,
  onSuccess,
  onConflict
}: ImpactDecisionDrawerProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImpactDecisionFetcherData>();
  const decision = candidate.decision;
  const initialStatus: ChangeNoticeImpactDecisionStatus =
    mode === "resolve" ? "Resolved" : (decision?.status ?? "Action required");
  const [decisionStatus, setDecisionStatus] =
    useState<ChangeNoticeImpactDecisionStatus>(initialStatus);
  const initialNoActionReason: ChangeNoticeImpactNoActionReasonCode =
    decision?.noActionReasonCode ?? "Not affected after review";
  const [noActionReason, setNoActionReason] =
    useState<ChangeNoticeImpactNoActionReasonCode>(initialNoActionReason);
  const [rationale, setRationale] = useState(() =>
    getChangeNoticeImpactRationaleDefault({
      persistedStatus: decision?.status ?? null,
      selectedStatus: initialStatus,
      persistedRationale: decision?.rationale
    })
  );
  const isSubmitting = fetcher.state !== "idle";
  const resolutionControls = getChangeNoticeImpactDecisionControls({
    candidate,
    coverageStatus,
    taskCoverageStatus,
    changeNoticeStatus,
    canUpdate: true
  });
  const resolveBlocked =
    mode === "resolve" && resolutionControls.resolveBlock !== null;
  const formDefaults = useMemo<
    z.infer<typeof changeNoticeImpactDecisionFormValidator>
  >(
    () => ({
      changeNoticeId,
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      decisionStatus: initialStatus,
      noActionReasonCode: initialNoActionReason,
      rationale: decision?.rationale ?? undefined,
      resolutionNote: decision?.resolutionNote ?? undefined,
      expectedRevision: decision?.revision,
      confirmNoPurchasingInterventionRemains: false
    }),
    [
      candidate.targetId,
      candidate.targetType,
      changeNoticeId,
      decision?.rationale,
      decision?.resolutionNote,
      decision?.revision,
      initialNoActionReason,
      initialStatus
    ]
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      onSuccess();
    } else if (fetcher.data.conflict) {
      onConflict(
        fetcher.data.error?.message ??
          "The Impact assessment changed while you were editing."
      );
    }
  }, [fetcher.data, fetcher.state, onConflict, onSuccess]);

  const statusOptions = useMemo(
    () =>
      mode === "resolve"
        ? []
        : getChangeNoticeImpactDecisionStatusOptions(decision),
    [decision, mode]
  );
  const isConclusionChange =
    decision !== null && decisionStatus !== decision.status;

  const reasonOptions = useMemo(
    () => [
      {
        value: "Not affected after review" as const,
        label: noActionReasonLabel("Not affected after review")
      },
      ...(candidate.targetType === "purchaseOrderLine"
        ? [
            {
              value: "No purchasing intervention remains" as const,
              label: noActionReasonLabel("No purchasing intervention remains")
            }
          ]
        : [])
    ],
    [candidate.targetType]
  );

  const failedResponse =
    fetcher.data && !fetcher.data.success ? fetcher.data : null;
  const isPurchasingConfirmation =
    decisionStatus === "No action required" &&
    noActionReason === "No purchasing intervention remains";

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="sm">
        <ValidatedForm
          key={`${candidate.targetType}-${candidate.targetId}-${mode}-${decision?.revision ?? "new"}`}
          validator={changeNoticeImpactDecisionFormValidator}
          method="post"
          action={path.to.changeNoticeImpactDecision(changeNoticeId)}
          defaultValues={formDefaults}
          fetcher={fetcher}
          className="flex h-full flex-col"
        >
          <DrawerHeader>
            <DrawerTitle>
              {mode === "resolve" ? (
                <Trans>Resolve operational impact</Trans>
              ) : decision ? (
                <Trans>Reassess operational impact</Trans>
              ) : (
                <Trans>Assess operational impact</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Hidden name="changeNoticeId" value={changeNoticeId} />
              <Hidden name="targetType" value={candidate.targetType} />
              <Hidden name="targetId" value={candidate.targetId} />
              {decision && (
                <Hidden name="expectedRevision" value={decision.revision} />
              )}

              <div className="w-full space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  {domainLabel(candidate.targetType)} · {candidate.targetId}
                </div>
                <SnapshotFacts candidate={candidate} />
                {candidate.freshness === "Changed since assessment" && (
                  <p className="text-orange-700 dark:text-orange-300">
                    <Trans>
                      Current source facts changed since the stored assessment.
                      Saving will capture a fresh assessment snapshot.
                    </Trans>
                  </p>
                )}
                <DecisionSummary candidate={candidate} />
              </div>

              {mode === "resolve" ? (
                <Hidden name="decisionStatus" value="Resolved" />
              ) : (
                <Select
                  name="decisionStatus"
                  label={t`Conclusion`}
                  options={statusOptions.map((status) => ({
                    value: status,
                    label: decisionLabel(status)
                  }))}
                  isRequired
                  onChange={(option) => {
                    if (option?.value) {
                      const nextStatus =
                        option.value as ChangeNoticeImpactDecisionStatus;
                      setDecisionStatus(nextStatus);
                      setRationale(
                        getChangeNoticeImpactRationaleDefault({
                          persistedStatus: decision?.status ?? null,
                          selectedStatus: nextStatus,
                          persistedRationale: decision?.rationale
                        })
                      );
                    }
                  }}
                />
              )}

              {decisionStatus === "No action required" && (
                <Select
                  name="noActionReasonCode"
                  label={t`No-action reason`}
                  options={reasonOptions}
                  isRequired
                  onChange={(option) => {
                    if (option?.value) {
                      setNoActionReason(
                        option.value as ChangeNoticeImpactNoActionReasonCode
                      );
                    }
                  }}
                />
              )}

              {isPurchasingConfirmation && (
                <Boolean
                  name="confirmNoPurchasingInterventionRemains"
                  label={t`Confirm no purchasing intervention remains`}
                  description={t`Supplier return, replacement, credit, and communication interventions have been reviewed.`}
                />
              )}

              {isConclusionChange &&
                decisionStatus === "No action required" && (
                  <p className="w-full text-xs text-muted-foreground">
                    <Trans>
                      Use No action required only if the earlier conclusion was
                      incorrect and intervention was never required. If
                      intervention occurred and closed the consequence, use
                      Resolve.
                    </Trans>
                  </p>
                )}
              {decisionStatus === "Action required" && (
                <TextAreaControlled
                  name="rationale"
                  label={
                    isConclusionChange
                      ? t`New follow-up rationale`
                      : t`Follow-up rationale`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}
              {decisionStatus === "No action required" && (
                <TextAreaControlled
                  name="rationale"
                  label={
                    isConclusionChange
                      ? t`Correction rationale`
                      : t`Review rationale`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}
              {decisionStatus === "Resolved" && (
                <TextArea
                  name="resolutionNote"
                  label={t`Closure evidence`}
                  isRequired
                />
              )}

              {resolveBlocked && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  {resolutionControls.resolveBlock === "taskCoverage" ? (
                    <Trans>
                      Resolution is unavailable until linked task coverage is
                      complete.
                    </Trans>
                  ) : (
                    <Trans>
                      Every linked task must be Completed or Skipped before this
                      Impact can be resolved.
                    </Trans>
                  )}
                </div>
              )}
              {failedResponse?.error?.message && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {failedResponse.error.message}
                </div>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={resolveBlocked} isLoading={isSubmitting}>
                {mode === "resolve" ? (
                  <Trans>Resolve</Trans>
                ) : mode === "assess" ? (
                  <Trans>Save assessment</Trans>
                ) : (
                  <Trans>Save reassessment</Trans>
                )}
              </Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}

function DecisionControls({
  candidate,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onOpen
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onOpen: (mode: ChangeNoticeImpactDecisionMode) => void;
}) {
  const controls = getChangeNoticeImpactDecisionControls({
    candidate,
    coverageStatus,
    taskCoverageStatus,
    changeNoticeStatus,
    canUpdate
  });
  if (!controls.assess && !controls.reassess && !controls.resolve) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
      {controls.assess && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOpen("assess")}
        >
          <Trans>Assess</Trans>
        </Button>
      )}
      {controls.reassess && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOpen("reassess")}
        >
          <Trans>Reassess</Trans>
        </Button>
      )}
      {controls.resolve && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          isDisabled={controls.resolveBlock !== null}
          onClick={() => onOpen("resolve")}
        >
          <Trans>Resolve</Trans>
        </Button>
      )}
      {controls.resolveBlock === "taskCoverage" && (
        <span className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>Resolve after linked task coverage is complete.</Trans>
        </span>
      )}
      {controls.resolveBlock === "nonTerminalTask" && (
        <span className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>
            Resolve after every linked task is Completed or Skipped.
          </Trans>
        </span>
      )}
    </div>
  );
}

function ImpactRow({
  changeNoticeId,
  candidate,
  actions,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory
}: {
  changeNoticeId: string;
  candidate: Candidate;
  actions: ChangeNoticeActionTask[];
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onRefresh: () => void;
  onOpenDecision: (
    candidate: Candidate,
    mode: ChangeNoticeImpactDecisionMode
  ) => void;
  onOpenHistory: (candidate: Candidate) => void;
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
        {(sourceLink(candidate) ||
          canViewChangeNoticeImpactHistory(candidate)) && (
          <div className="flex shrink-0 items-center gap-1">
            {sourceLink(candidate)}
            {canViewChangeNoticeImpactHistory(candidate) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenHistory(candidate)}
              >
                <LuHistory className="size-3.5" />
                <Trans>History</Trans>
              </Button>
            )}
          </div>
        )}
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
      <ChangeNoticeImpactTasks
        changeNoticeId={changeNoticeId}
        changeNoticeStatus={changeNoticeStatus}
        candidate={candidate}
        actions={actions}
        canUpdate={canUpdate}
        taskCoverageStatus={taskCoverageStatus}
        onRefresh={onRefresh}
      />
      <DecisionControls
        candidate={candidate}
        coverageStatus={coverageStatus}
        taskCoverageStatus={taskCoverageStatus}
        changeNoticeStatus={changeNoticeStatus}
        canUpdate={canUpdate}
        onOpen={(mode) => onOpenDecision(candidate, mode)}
      />
    </div>
  );
}

export function groupCandidates(candidates: Candidate[]): Group[] {
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
  changeNoticeId,
  candidates,
  actions,
  emptyMessage,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory
}: {
  changeNoticeId: string;
  candidates: Candidate[];
  actions: ChangeNoticeActionTask[];
  emptyMessage: ReactNode;
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onRefresh: () => void;
  onOpenDecision: (
    candidate: Candidate,
    mode: ChangeNoticeImpactDecisionMode
  ) => void;
  onOpenHistory: (candidate: Candidate) => void;
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
                changeNoticeId={changeNoticeId}
                candidate={candidate}
                actions={actions}
                coverageStatus={coverage[candidate.targetType].status}
                taskCoverageStatus={taskCoverageStatus}
                changeNoticeStatus={changeNoticeStatus}
                canUpdate={canUpdate}
                onRefresh={onRefresh}
                onOpenDecision={onOpenDecision}
                onOpenHistory={onOpenHistory}
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
  data,
  actions
}: WorkspaceProps) {
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const [params] = useUrlParams();
  const [decisionTarget, setDecisionTarget] = useState<{
    candidate: Candidate;
    mode: ChangeNoticeImpactDecisionMode;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Candidate | null>(null);
  const [decisionConflictMessage, setDecisionConflictMessage] = useState<
    string | null
  >(null);
  const canUpdate = permissions.can("update", "parts") ?? false;
  const search = params.get("search") ?? "";
  const filters = getImpactFilterValues(params.getAll("filter"));
  const coverageHasWarning = [
    data.coverage.purchaseOrderLine,
    data.coverage.job,
    data.coverage.jobMaterial
  ].some((coverage) => coverage.status !== "complete");
  const hasDisplayFilters = hasImpactDisplayFilters(search, filters);
  const filteredCandidates = filterChangeNoticeImpactCandidates({
    candidates: data.candidates,
    search,
    filters,
    coverage: data.coverage,
    taskCoverageStatus: data.taskCoverage.status
  });
  const filteredEmptyState = getImpactFilteredEmptyState({
    candidateCount: filteredCandidates.length,
    hasDisplayFilters,
    coverageHasWarning:
      coverageHasWarning ||
      hasIncompleteImpactTaskFilter(filters, data.taskCoverage.status)
  });
  const currentCandidates = filteredCandidates.filter(isCurrent);
  const currentPurchaseOrderCandidates = currentCandidates.filter(
    (candidate) => candidate.targetType === "purchaseOrderLine"
  );
  const currentProductionCandidates = currentCandidates.filter(
    (candidate) =>
      candidate.targetType === "job" || candidate.targetType === "jobMaterial"
  );
  const historicalCandidates = filteredCandidates.filter(isHistorical);
  const unavailableCandidates = filteredCandidates.filter(isUnavailable);
  const taskCoverageHasWarning = data.taskCoverage.status !== "complete";
  const status = changeNotice?.status ?? data.changeNoticeStatus;
  const openDecision = useCallback(
    (candidate: Candidate, mode: ChangeNoticeImpactDecisionMode) => {
      setDecisionConflictMessage(null);
      setDecisionTarget({ candidate, mode });
    },
    []
  );
  const closeDecision = useCallback(() => setDecisionTarget(null), []);
  const openHistory = useCallback((candidate: Candidate) => {
    setHistoryTarget(candidate);
  }, []);
  const closeHistory = useCallback(() => setHistoryTarget(null), []);
  const handleDecisionSuccess = useCallback(() => {
    setDecisionTarget(null);
    revalidator.revalidate();
  }, [revalidator]);
  const handleDecisionConflict = useCallback(
    (message: string) => {
      setDecisionTarget(null);
      setDecisionConflictMessage(message);
      revalidator.revalidate();
    },
    [revalidator]
  );
  const handleTaskMutation = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

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
        <Button
          type="button"
          variant="secondary"
          onClick={() => revalidator.revalidate()}
          isDisabled={revalidator.state !== "idle"}
          isLoading={revalidator.state !== "idle"}
        >
          <LuRefreshCw className="size-3.5" />
          <Trans>Refresh</Trans>
        </Button>
      </div>

      {decisionConflictMessage && (
        <div
          role="alert"
          className="w-full rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <div className="font-medium">
            <Trans>Impact assessment changed while you were editing.</Trans>
          </div>
          <div>{decisionConflictMessage}</div>
          <div>
            <Trans>
              The editor was closed and the workspace was refreshed. Review the
              current state before submitting again.
            </Trans>
          </div>
        </div>
      )}

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

      <ChangeNoticeImpactFilterBar
        taskCoverageStatus={data.taskCoverage.status}
      />

      {filteredEmptyState ? (
        <div className="w-full rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {filteredEmptyState === "incomplete" ? (
            <Trans>
              No matching loaded Impact rows are visible. Coverage is
              incomplete, so this is not a complete result.
            </Trans>
          ) : (
            <Trans>No Impact rows match the current search and filters.</Trans>
          )}
        </div>
      ) : (
        <>
          {(currentCandidates.length > 0 || !hasDisplayFilters) && (
            <section className="w-full space-y-3">
              <div>
                <h2 className="text-base font-semibold">
                  <Trans>Current operational exposure</Trans>
                </h2>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Supported purchasing and production targets that can receive
                    an independent Impact assessment.
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
                  {(currentPurchaseOrderCandidates.length > 0 ||
                    !hasDisplayFilters) && (
                    <DocumentGroups
                      changeNoticeId={id}
                      candidates={currentPurchaseOrderCandidates}
                      actions={actions}
                      coverage={data.coverage}
                      taskCoverageStatus={data.taskCoverage.status}
                      changeNoticeStatus={status}
                      canUpdate={canUpdate}
                      onRefresh={handleTaskMutation}
                      onOpenDecision={openDecision}
                      onOpenHistory={openHistory}
                      emptyMessage={
                        <Trans>No Purchase Order lines are available.</Trans>
                      }
                    />
                  )}
                  {(currentProductionCandidates.length > 0 ||
                    !hasDisplayFilters) && (
                    <DocumentGroups
                      changeNoticeId={id}
                      candidates={currentProductionCandidates}
                      actions={actions}
                      coverage={data.coverage}
                      taskCoverageStatus={data.taskCoverage.status}
                      changeNoticeStatus={status}
                      canUpdate={canUpdate}
                      onRefresh={handleTaskMutation}
                      onOpenDecision={openDecision}
                      onOpenHistory={openHistory}
                      emptyMessage={
                        <Trans>No Jobs or Job Materials are available.</Trans>
                      }
                    />
                  )}
                </>
              )}
            </section>
          )}

          {(historicalCandidates.length > 0 || !hasDisplayFilters) && (
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
                changeNoticeId={id}
                candidates={historicalCandidates}
                actions={actions}
                coverage={data.coverage}
                taskCoverageStatus={data.taskCoverage.status}
                changeNoticeStatus={status}
                canUpdate={canUpdate}
                onRefresh={handleTaskMutation}
                onOpenDecision={openDecision}
                onOpenHistory={openHistory}
                emptyMessage={
                  coverageHasWarning ? (
                    <Trans>Historical coverage is incomplete.</Trans>
                  ) : (
                    <Trans>No historical references are available.</Trans>
                  )
                }
              />
            </section>
          )}

          {unavailableCandidates.length > 0 && (
            <section className="w-full space-y-3">
              <div>
                <h2 className="text-base font-semibold">
                  <Trans>Unavailable source rows</Trans>
                </h2>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Source identities are retained only where they were
                    authorized; decision-relevant facts are withheld until
                    coverage is restored.
                  </Trans>
                </p>
              </div>
              <DocumentGroups
                changeNoticeId={id}
                candidates={unavailableCandidates}
                actions={actions}
                coverage={data.coverage}
                taskCoverageStatus={data.taskCoverage.status}
                changeNoticeStatus={status}
                canUpdate={canUpdate}
                onRefresh={handleTaskMutation}
                onOpenDecision={openDecision}
                onOpenHistory={openHistory}
                emptyMessage={
                  <Trans>No unavailable source rows are available.</Trans>
                }
              />
            </section>
          )}
        </>
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

      {decisionTarget && (
        <ImpactDecisionDrawer
          key={`${decisionTarget.candidate.targetType}-${decisionTarget.candidate.targetId}-${decisionTarget.mode}-${decisionTarget.candidate.decision?.revision ?? "new"}`}
          changeNoticeId={id}
          candidate={decisionTarget.candidate}
          mode={decisionTarget.mode}
          coverageStatus={
            data.coverage[decisionTarget.candidate.targetType].status
          }
          taskCoverageStatus={data.taskCoverage.status}
          changeNoticeStatus={status}
          onClose={closeDecision}
          onSuccess={handleDecisionSuccess}
          onConflict={handleDecisionConflict}
        />
      )}
      {historyTarget && (
        <ChangeNoticeImpactHistory
          key={`${historyTarget.targetType}-${historyTarget.targetId}-${historyTarget.decision?.revision ?? "new"}`}
          changeNoticeId={id}
          candidate={historyTarget}
          actions={actions}
          onClose={closeHistory}
        />
      )}
    </VStack>
  );
}
