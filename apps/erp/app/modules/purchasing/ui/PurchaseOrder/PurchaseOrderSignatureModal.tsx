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
  Status,
  Textarea,
  toast,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import { useFetcher, useParams } from "react-router";
import { path } from "~/utils/path";
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
  const [isSending, setIsSending] = useState(false);

  // Check existing signature status on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusFetcher.load changes on every render
  useEffect(() => {
    statusFetcher.load(`/api/integrations/docusign/status/${orderId}`);
  }, [orderId]);

  const existingEnvelope = statusFetcher.data?.hasEnvelope
    ? statusFetcher.data.envelope
    : null;

  const handleSend = useCallback(async () => {
    if (!signerName || !signerEmail || !emailSubject) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setIsSending(true);

    try {
      // Fetch the PO PDF
      const pdfResponse = await fetch(path.to.file.purchaseOrder(orderId));

      if (!pdfResponse.ok) {
        toast.error("Failed to generate purchase order PDF.");
        setIsSending(false);
        return;
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(pdfBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );

      sendFetcher.submit(
        {
          purchaseOrderId: orderId,
          signerName,
          signerEmail,
          emailSubject,
          emailBody,
          documentBase64: base64,
          documentName: `${purchaseOrder?.purchaseOrderId ?? "PurchaseOrder"}.pdf`
        },
        {
          method: "POST",
          action: "/api/integrations/docusign/send-signature",
          encType: "application/json"
        }
      );
    } catch {
      toast.error("An error occurred while sending the document.");
      setIsSending(false);
    }
  }, [
    signerName,
    signerEmail,
    emailSubject,
    emailBody,
    orderId,
    purchaseOrder?.purchaseOrderId,
    sendFetcher
  ]);

  // Handle send response
  useEffect(() => {
    if (sendFetcher.state === "idle" && sendFetcher.data) {
      setIsSending(false);
      const result = sendFetcher.data as { success?: boolean; error?: string };
      if (result.success) {
        toast.success("Document sent for signature.");
        onClose();
      } else if (result.error) {
        toast.error(result.error);
      }
    }
  }, [sendFetcher.state, sendFetcher.data, onClose]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
      case "signed":
        return "green";
      case "sent":
      case "delivered":
        return "blue";
      case "declined":
      case "voided":
        return "red";
      default:
        return "gray";
    }
  };

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
          <ModalTitle>
            {existingEnvelope ? "Signature Status" : "Request Signature"}
          </ModalTitle>
          <ModalDescription>
            {existingEnvelope
              ? "View the current signature status for this purchase order."
              : "Send this purchase order to a signer via DocuSign."}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {existingEnvelope ? (
            <VStack spacing={4}>
              <HStack>
                <Label className="font-medium">Status</Label>
                <Status color={getStatusColor(existingEnvelope.status)}>
                  {existingEnvelope.status}
                </Status>
              </HStack>
              <div>
                <Label className="font-medium">Signer</Label>
                <p className="text-sm text-muted-foreground">
                  {existingEnvelope.signerName} ({existingEnvelope.signerEmail})
                </p>
              </div>
              <div>
                <Label className="font-medium">Subject</Label>
                <p className="text-sm text-muted-foreground">
                  {existingEnvelope.subject}
                </p>
              </div>
              {existingEnvelope.sentAt && (
                <div>
                  <Label className="font-medium">Sent</Label>
                  <p className="text-sm text-muted-foreground">
                    {new Date(existingEnvelope.sentAt).toLocaleString()}
                  </p>
                </div>
              )}
              {existingEnvelope.completedDateTime && (
                <div>
                  <Label className="font-medium">Completed</Label>
                  <p className="text-sm text-muted-foreground">
                    {new Date(
                      existingEnvelope.completedDateTime
                    ).toLocaleString()}
                  </p>
                </div>
              )}
            </VStack>
          ) : (
            <VStack spacing={4}>
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
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="secondary" onClick={onClose}>
              {existingEnvelope ? "Close" : "Cancel"}
            </Button>
            {!existingEnvelope && (
              <Button
                variant="primary"
                isLoading={isSending || sendFetcher.state !== "idle"}
                isDisabled={!signerName || !signerEmail || !emailSubject}
                onClick={handleSend}
              >
                Send for Signature
              </Button>
            )}
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderSignatureModal;
