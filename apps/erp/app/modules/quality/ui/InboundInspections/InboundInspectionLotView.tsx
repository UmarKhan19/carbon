import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BarProgress,
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuScan,
  LuShieldAlert,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getReadableIdWithRevision } from "~/utils/string";
import ScanInspectionSample from "./ScanInspectionSample";

type LotTrackedEntity = {
  id: string;
  attributes: Record<string, unknown>;
  sourceDocumentReadableId: string | null;
  status: string | null;
};

type LotSample = {
  id: string;
  trackedEntityId: string;
  status: "Pending" | "Passed" | "Failed";
  notes: string | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
  trackedEntity: LotTrackedEntity | null;
};

export type InboundInspectionLotViewProps = {
  inspection: {
    id: string;
    itemId: string;
    itemReadableId: string | null;
    lotSize: number;
    sampleSize: number;
    acceptanceNumber: number;
    rejectionNumber: number;
    samplingStandard: "ANSI_Z1_4" | "ISO_2859_1";
    samplingPlanType: "All" | "First" | "Percentage" | "AQL";
    aql: number | null;
    inspectionLevel: string | null;
    severity: string | null;
    codeLetter: string | null;
    status: string;
    dispositionedAt: string | null;
    receiptId: string;
  };
  receiptReadableId: string | null;
  receiverId: string | null;
  itemName: string;
  supplierName: string | null;
  samples: LotSample[];
  lotEntities: LotTrackedEntity[];
  currentUserId: string;
  enforceFourEyes: boolean;
  open?: boolean;
};

function getSerialOrBatch(e: LotTrackedEntity): string | null {
  const attrs = (e.attributes ?? {}) as Record<string, string>;
  return attrs["Serial Number"] ?? attrs["Batch Number"] ?? null;
}

export default function InboundInspectionLotView({
  inspection,
  receiptReadableId,
  receiverId,
  itemName,
  supplierName,
  samples,
  lotEntities,
  currentUserId,
  enforceFourEyes,
  open = true
}: InboundInspectionLotViewProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const [items] = useItems();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false);
  const [partialConfirmOpen, setPartialConfirmOpen] = useState(false);

  // Look up the item in the live items store so we show the current
  // readable id (and revision) even if the snapshot stored on the
  // inspection row is stale.
  const item = items.find((i) => i.id === inspection.itemId);
  // The store exposes `readableIdWithRevision` pre-computed; split it so we
  // can run it through getReadableIdWithRevision for consistent formatting.
  const [storeReadableId, storeRevision] = (() => {
    const combined = (item as any)?.readableIdWithRevision as
      | string
      | undefined;
    if (!combined) return [undefined, undefined] as const;
    const dot = combined.lastIndexOf(".");
    if (dot < 0) return [combined, undefined] as const;
    return [combined.slice(0, dot), combined.slice(dot + 1)] as const;
  })();
  const displayReadableId =
    storeReadableId != null
      ? getReadableIdWithRevision(storeReadableId, storeRevision)
      : (inspection.itemReadableId ?? "");
  const displayItemName = item?.name ?? itemName;

  const passes = samples.filter((s) => s.status === "Passed").length;
  const fails = samples.filter((s) => s.status === "Failed").length;
  const inspected = passes + fails;

  const sampledIds = useMemo(
    () => new Set(samples.map((s) => s.trackedEntityId)),
    [samples]
  );
  const remaining = lotEntities.filter((e) => !sampledIds.has(e.id));

  const showFourEyesWarning =
    enforceFourEyes && !!receiverId && receiverId === currentUserId;

  // The lot is "closed" only after the inspector has pressed Accept or Reject
  // (setting dispositionedAt + a terminal status). Partial is explicitly not
  // closed — the inspector can keep scanning and disposition again later.
  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" || inspection.status === "Failed");

  const canAccept =
    !lotClosed &&
    inspected >= inspection.sampleSize &&
    fails <= inspection.acceptanceNumber;
  const canReject = !lotClosed && fails > inspection.acceptanceNumber;
  const canPartial = !lotClosed && inspected > 0;

  const failedTrackedEntityIds = samples
    .filter((s) => s.status === "Failed")
    .map((s) => s.trackedEntityId);

  const newIssueHref = `/x/issue/new?itemId=${encodeURIComponent(inspection.itemId)}&trackedEntityIds=${encodeURIComponent(failedTrackedEntityIds.join(","))}&sourceInspectionId=${encodeURIComponent(inspection.id)}`;

  const acceptUrl = `${path.to.inboundInspection(inspection.id)}/accept`;
  const rejectUrl = `${path.to.inboundInspection(inspection.id)}/reject`;
  const partialUrl = `${path.to.inboundInspection(inspection.id)}/partial`;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) navigate(-1);
        }}
      >
        <ModalDrawerContent size="full">
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Inspect</Trans> {displayReadableId || displayItemName}
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <VStack spacing={4} className="w-full">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full text-sm">
                <Kv
                  label={t`Item`}
                  value={displayReadableId}
                  sub={displayItemName}
                />
                <Kv
                  label={t`Receipt`}
                  value={receiptReadableId ?? ""}
                  sub={supplierName ?? undefined}
                />
                <Kv
                  label={t`Plan`}
                  value={
                    inspection.samplingPlanType === "AQL"
                      ? `AQL ${inspection.aql ?? ""} · Lvl ${inspection.inspectionLevel ?? ""} · ${inspection.severity ?? ""}`
                      : inspection.samplingPlanType
                  }
                  sub={
                    inspection.samplingStandard === "ANSI_Z1_4"
                      ? "ANSI/ASQ Z1.4"
                      : "ISO 2859-1"
                  }
                />
                <Kv
                  label={t`Sample`}
                  value={`${inspected} / ${inspection.sampleSize}`}
                  sub={`Ac ${inspection.acceptanceNumber} · Re ${inspection.rejectionNumber}${inspection.codeLetter ? ` · ${inspection.codeLetter}` : ""}`}
                />
              </div>

              {showFourEyesWarning && (
                <Alert variant="warning">
                  <LuTriangleAlert className="size-4" />
                  <AlertTitle>
                    <Trans>You received this lot</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Company policy asks for a different person to inspect
                      inbound items than the one who received them.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}

              {/* Progress */}
              <BarProgress
                label={t`Progress`}
                value={`${inspected} / ${inspection.sampleSize} · ${fails} ${fails === 1 ? "failure" : "failures"} · Ac ${inspection.acceptanceNumber}`}
                progress={inspected}
                max={Math.max(1, inspection.sampleSize)}
                activeClassName={
                  fails > inspection.acceptanceNumber
                    ? "bg-red-500"
                    : "bg-emerald-500"
                }
              />

              {/* Scan button */}
              {!lotClosed && canUpdate && (
                <Button
                  leftIcon={<LuScan />}
                  onClick={() => setScannerOpen(true)}
                  className="self-start"
                >
                  <Trans>Inspect Next Item</Trans>
                </Button>
              )}

              {/* Samples */}
              <div className="w-full border rounded-md overflow-hidden">
                <table className="text-sm w-full">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Entity</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Result</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Inspector</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Notes</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          <Trans>No samples inspected yet.</Trans>
                        </td>
                      </tr>
                    )}
                    {samples.map((s) => {
                      const sob = s.trackedEntity
                        ? getSerialOrBatch(s.trackedEntity)
                        : null;
                      return (
                        <tr key={s.id} className="border-t">
                          <td className="px-3 py-2">
                            <div className="flex flex-col">
                              <span className="font-mono text-sm">
                                {s.trackedEntityId}
                              </span>
                              {sob && (
                                <span className="text-xs text-muted-foreground">
                                  {sob}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {s.status === "Passed" ? (
                              <Badge variant="green">
                                <LuCircleCheck className="size-3 mr-1" /> Passed
                              </Badge>
                            ) : s.status === "Failed" ? (
                              <Badge variant="red">
                                <LuCircleX className="size-3 mr-1" /> Failed
                              </Badge>
                            ) : (
                              <Badge variant="secondary">{s.status}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {s.inspectedBy ? (
                              <EmployeeAvatar employeeId={s.inspectedBy} />
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.notes ?? ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </VStack>
          </ModalDrawerBody>
          <ModalDrawerFooter>
            <HStack spacing={2} className="w-full justify-between">
              <Button
                variant="secondary"
                leftIcon={<LuShieldAlert />}
                asChild
                isDisabled={failedTrackedEntityIds.length === 0}
              >
                <a href={newIssueHref} target="_blank" rel="noreferrer">
                  <Trans>Create Issue from Inspection</Trans>
                </a>
              </Button>
              <HStack spacing={2}>
                <Button
                  variant="secondary"
                  onClick={() => setPartialConfirmOpen(true)}
                  isDisabled={!canUpdate || !canPartial}
                >
                  <Trans>Partial</Trans>
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setRejectConfirmOpen(true)}
                  isDisabled={!canUpdate || !canReject}
                >
                  <Trans>Reject Lot</Trans>
                </Button>
                <Button
                  onClick={() => setAcceptConfirmOpen(true)}
                  isDisabled={!canUpdate || !canAccept}
                >
                  <Trans>Accept Lot</Trans>
                </Button>
              </HStack>
            </HStack>
          </ModalDrawerFooter>
        </ModalDrawerContent>
      </ModalDrawer>

      {scannerOpen && (
        <ScanInspectionSample
          inspectionId={inspection.id}
          remaining={remaining}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {acceptConfirmOpen && (
        <Confirm
          action={acceptUrl}
          title={t`Accept lot?`}
          text={t`${lotEntities.length - inspected} un-sampled entities will be released to Available. Sampled passes stay Available and sampled failures stay Rejected.`}
          confirmText={t`Accept Lot`}
          onCancel={() => setAcceptConfirmOpen(false)}
          onSubmit={() => setAcceptConfirmOpen(false)}
        />
      )}

      {partialConfirmOpen && (
        <Confirm
          action={partialUrl}
          title={t`Mark lot as partial?`}
          text={t`Un-sampled entities will remain On Hold so you can keep inspecting and disposition later. Sampled outcomes are preserved.`}
          confirmText={t`Mark Partial`}
          onCancel={() => setPartialConfirmOpen(false)}
          onSubmit={() => setPartialConfirmOpen(false)}
        />
      )}

      {rejectConfirmOpen && (
        <ConfirmDelete
          action={rejectUrl}
          name={t`Lot`}
          text={t`Statistical acceptance failed, so the entire lot is considered non-conforming (ISO 9001:2015 §8.7). All ${lotEntities.length} entities — ${passes} sampled pass(es), ${fails} failure(s), and ${Math.max(0, lotEntities.length - inspected)} un-inspected — will be marked Rejected. An NCR will be opened automatically for MRB disposition.`}
          deleteText={t`Reject Lot`}
          onCancel={() => setRejectConfirmOpen(false)}
          onSubmit={() => setRejectConfirmOpen(false)}
        />
      )}
    </ModalDrawerProvider>
  );
}

function Kv({
  label,
  value,
  sub
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium truncate">{value || "—"}</span>
      {sub && (
        <span className="text-xs text-muted-foreground truncate">{sub}</span>
      )}
    </div>
  );
}
