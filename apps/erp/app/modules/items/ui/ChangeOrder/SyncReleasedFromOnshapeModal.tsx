import { OnshapeLogo } from "@carbon/ee";
import {
  Button,
  Combobox,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Status,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useNavigate } from "react-router";

import { OnshapeStatus } from "~/components/Icons";
import type { loader as revisionsLoader } from "~/routes/api+/integrations.onshape.d.$did.revisions";
import type { action as importAction } from "~/routes/api+/integrations.onshape.import";
import { path } from "~/utils/path";

// Pick an Onshape document, then a released revision to import. On success,
// navigate to the created Draft change order; on refusal, toast the server message.
type SyncReleasedFromOnshapeModalProps = {
  onClose: () => void;
};

type ReleasedRevisionRow = NonNullable<
  Awaited<ReturnType<typeof revisionsLoader>>["data"]
>[number];

const SyncReleasedFromOnshapeModal = ({
  onClose
}: SyncReleasedFromOnshapeModalProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null
  );

  const documentsFetcher = useFetcher<
    | { data: { items: { id: string; name: string }[] }; error: null }
    | { data: null; error: string }
  >({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    documentsFetcher.load(path.to.api.onShapeDocuments);
  }, []);

  useEffect(() => {
    if (documentsFetcher.data?.error) {
      toast.error(documentsFetcher.data.error);
    }
  }, [documentsFetcher.data]);

  const documentOptions = useMemo(
    () =>
      documentsFetcher.data?.data?.items
        ?.map((c) => ({ value: c.id, label: c.name }))
        .sort((a, b) => a.label.localeCompare(b.label)) ?? [],
    [documentsFetcher.data]
  );

  const revisionsFetcher = useFetcher<typeof revisionsLoader>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on documentId
  useEffect(() => {
    setSelectedRevisionId(null);
    if (documentId) {
      revisionsFetcher.load(path.to.api.onShapeReleasedRevisions(documentId));
    }
  }, [documentId]);

  useEffect(() => {
    if (revisionsFetcher.data?.error) {
      toast.error(revisionsFetcher.data.error);
    }
  }, [revisionsFetcher.data]);

  const revisions = revisionsFetcher.data?.data ?? [];
  const selectedRevision = revisions.find((r) => r.id === selectedRevisionId);

  const importFetcher = useFetcher<typeof importAction>();

  useEffect(() => {
    if (!importFetcher.data) return;
    if (importFetcher.data.success === false) {
      toast.error(importFetcher.data.message);
    } else if (importFetcher.data.success === true) {
      onClose();
      toast.success(t`Imported into draft change order`);
      // Non-fatal warnings (e.g. a drawing/geometry pull skipped or still
      // processing) — the change order + BOM still landed.
      for (const warning of importFetcher.data.warnings ?? []) {
        toast.warning(warning);
      }
      navigate(path.to.changeOrder(importFetcher.data.changeOrderId));
    }
  }, [importFetcher.data, navigate, onClose, t]);

  const onImport = () => {
    if (!documentId || !selectedRevision || !selectedRevision.partNumber)
      return;
    const formData = new FormData();
    formData.append("documentId", documentId);
    formData.append("revisionId", selectedRevision.id);
    formData.append("versionId", selectedRevision.sourceVid);
    formData.append("partNumber", selectedRevision.partNumber);
    if (selectedRevision.elementId)
      formData.append("elementId", selectedRevision.elementId);
    formData.append("revisionLabel", selectedRevision.revisionLabel);
    if (selectedRevision.configurationId)
      formData.append("configurationId", selectedRevision.configurationId);
    if (selectedRevision.fullConfiguration)
      formData.append("fullConfiguration", selectedRevision.fullConfiguration);
    importFetcher.submit(formData, {
      method: "post",
      action: path.to.api.onShapeImport
    });
  };

  const isImporting = importFetcher.state !== "idle";
  const isLoadingRevisions = revisionsFetcher.state === "loading";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent onInteractOutside={(e) => e.preventDefault()}>
        <ModalHeader>
          <ModalTitle>
            <span className="flex items-center gap-2">
              <OnshapeLogo className="h-4 w-auto" />
              <Trans>Sync from OnShape</Trans>
            </span>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Pick a connected document, then a released object to import into a
              draft change order.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Document</Trans>
              </span>
              <Combobox
                isLoading={documentsFetcher.state === "loading"}
                options={documentOptions}
                size="sm"
                value={documentId ?? undefined}
                onChange={(value) => setDocumentId(value)}
                placeholder={t`Select a document`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Released Object</Trans>
              </span>
              <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border">
                {!documentId ? (
                  <span className="px-2 py-3 text-xs text-muted-foreground">
                    <Trans>Select a document to list released objects.</Trans>
                  </span>
                ) : isLoadingRevisions ? (
                  <div className="flex items-center justify-center py-6">
                    <Spinner className="size-4" />
                  </div>
                ) : revisions.length === 0 ? (
                  <span className="px-2 py-3 text-xs text-muted-foreground">
                    <Trans>No released revisions in this document.</Trans>
                  </span>
                ) : (
                  revisions.map((row: ReleasedRevisionRow) => (
                    <button
                      key={row.id}
                      type="button"
                      disabled={!row.partNumber}
                      onClick={() => setSelectedRevisionId(row.id)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                        selectedRevisionId === row.id && "bg-accent"
                      )}
                    >
                      {row.partNumber ? (
                        <span className="font-medium whitespace-nowrap">
                          {row.partNumber} · {row.revisionLabel}
                        </span>
                      ) : (
                        <Status color="red">
                          <Trans>No Part Number</Trans>
                        </Status>
                      )}
                      <span className="line-clamp-1 flex-1 text-muted-foreground">
                        {row.name}
                      </span>
                      {row.configurationId && (
                        <Status color="blue">
                          <Trans>Configured</Trans>
                        </Status>
                      )}
                      <OnshapeStatus status={row.state} />
                    </button>
                  ))
                )}
              </div>
            </div>

            {selectedRevision?.configurationId && (
              <span className="text-xs text-muted-foreground">
                <Trans>
                  This is a configured object — its configuration will be
                  imported.
                </Trans>
              </span>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            onClick={onImport}
            isLoading={isImporting}
            isDisabled={
              isImporting || !selectedRevision || !selectedRevision.partNumber
            }
          >
            <Trans>Import</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SyncReleasedFromOnshapeModal;
