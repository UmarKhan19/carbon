import {
  Button,
  HStack,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
  toast,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { PurchaseOrder } from "../../types";

type PurchaseOrderSignatureModalProps = {
  purchaseOrder?: PurchaseOrder;
  onClose: () => void;
};

type SignatureStatus = {
  hasEnvelope: boolean;
  envelope: {
    envelopeId: string;
    status: string;
    signerName: string;
    signerEmail: string;
    subject: string;
    sentAt?: string;
    completedDateTime?: string;
  } | null;
};

const PurchaseOrderSignatureModal = ({
  purchaseOrder,
  onClose
}: PurchaseOrderSignatureModalProps) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const sendFetcher = useFetcher();
  const statusFetcher = useFetcher<SignatureStatus>();

  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState(
    `Please sign: ${purchaseOrder?.purchaseOrderId ?? "Purchase Order"}`
  );
  const [emailBody, setEmailBody] = useState(
    "Please review and sign the attached purchase order."
  );

  // Check existing signature status on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusFetcher.load changes on every render
  useEffect(() => {
    statusFetcher.load(`/api/integrations/docusign/status/${orderId}`);
  }, [orderId]);

  const handleSend = () => {
    if (!signerName || !signerEmail || !emailSubject) {
      toast.error("Please fill in all required fields.");
      return;
    }

    sendFetcher.submit(
      {
        purchaseOrderId: orderId,
        signerName,
        signerEmail,
        emailSubject,
        emailBody
      },
      {
        method: "POST",
        action: "/api/integrations/docusign/send-signature",
        encType: "application/json"
      }
    );
  };

  // Handle send response
  useEffect(() => {
    if (sendFetcher.state === "idle" && sendFetcher.data) {
      const result = sendFetcher.data as { success?: boolean; error?: string };
      if (result.success) {
        toast.success("Document sent for signature.");
        onClose();
      } else if (result.error) {
        toast.error(result.error);
      }
    }
  }, [sendFetcher.state, sendFetcher.data, onClose]);

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
        <ModalHeader>
          <ModalTitle>{"Request Signature"}</ModalTitle>
          <ModalDescription>
            {"Send this purchase order to a signer via DocuSign."}
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="flex-col">
          <VStack className="w-full items-stretch" spacing={4}>
            <div>
              <Label htmlFor="signerName">Signer Name *</Label>
              <Input
                id="signerName"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Enter signer's full name"
              />
            </div>
            <div>
              <Label htmlFor="signerEmail">Signer Email *</Label>
              <Input
                id="signerEmail"
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="Enter signer's email address"
              />
            </div>
            <div>
              <Label htmlFor="emailSubject">Email Subject *</Label>
              <Input
                id="emailSubject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="emailBody">Message (Optional)</Label>
              <Textarea
                id="emailBody"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={3}
              />
            </div>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              isLoading={sendFetcher.state !== "idle"}
              isDisabled={!signerName || !signerEmail || !emailSubject}
              onClick={handleSend}
            >
              Send for Signature
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderSignatureModal;
