import { Hidden, TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useParams } from "react-router";
import { supplierApprovalDecisionValidator } from "~/modules/purchasing";
import type { ApprovalDecision } from "~/modules/shared/types";
import { path } from "~/utils/path";

type SupplierApprovalModalProps = {
  supplierName?: string;
  approvalRequestId: string;
  decision: ApprovalDecision;
  onClose: () => void;
};

const SupplierApprovalModal = ({
  supplierName,
  approvalRequestId,
  decision,
  onClose
}: SupplierApprovalModalProps) => {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const isApproving = decision === "Approved";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={supplierApprovalDecisionValidator}
          action={path.to.supplierApproval(supplierId)}
          onSubmit={onClose}
          defaultValues={{
            approvalRequestId,
            decision,
            notes: undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {isApproving ? "Approve" : "Reject"} {supplierName}
            </ModalTitle>
            <ModalDescription>
              {isApproving
                ? "Are you sure you want to approve this supplier? This will make it active."
                : "Are you sure you want to reject this supplier?"}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="approvalRequestId" />
            <Hidden name="decision" />
            <TextArea
              name="notes"
              label="Notes (optional)"
              placeholder="Add any notes about your decision..."
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={isApproving ? "primary" : "destructive"}
            >
              {isApproving ? "Approve" : "Reject"}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SupplierApprovalModal;
