import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type { action as decisionAction } from "~/routes/x+/change-order+/$id.decision";

// Shared reason modal for the Approve / Reject reviewer decisions. Both flows
// post the same { decision, reason } payload to the decision route; the title,
// body, and primary-button styling branch on `decision`.
type ChangeOrderDecisionModalProps = {
  changeOrderId: string;
  decision: "approve" | "reject";
  onClose: () => void;
};

const ChangeOrderDecisionModal = ({
  changeOrderId,
  decision,
  onClose
}: ChangeOrderDecisionModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof decisionAction>();
  const [reason, setReason] = useState("");
  const hasSubmitted = useRef(false);

  const isReject = decision === "reject";
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (hasSubmitted.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  const onSubmit = () => {
    if (!reason.trim()) return;
    hasSubmitted.current = true;
    const formData = new FormData();
    formData.append("decision", decision);
    formData.append("reason", reason);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderDecision(changeOrderId)
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
          <ModalTitle>
            {isReject ? (
              <Trans>Reject Change Order</Trans>
            ) : (
              <Trans>Approve Change Order</Trans>
            )}
          </ModalTitle>
          <ModalDescription>
            {isReject ? (
              <Trans>
                Rejecting returns the change order to Draft and resets all
                reviewers. Explain what needs to change.
              </Trans>
            ) : (
              <Trans>
                Record your approval. Add a note for the audit trail.
              </Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isReject ? t`Reason for rejection` : t`Approval notes`
            }
            rows={4}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            variant={isReject ? "destructive" : "primary"}
            onClick={onSubmit}
            isLoading={isSubmitting}
            isDisabled={isSubmitting || !reason.trim()}
          >
            {isReject ? <Trans>Reject</Trans> : <Trans>Approve</Trans>}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ChangeOrderDecisionModal;
