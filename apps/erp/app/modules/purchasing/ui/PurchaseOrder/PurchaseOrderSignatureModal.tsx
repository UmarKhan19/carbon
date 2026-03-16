import { ValidatedForm, validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useState } from "react";
import { useParams } from "react-router";
import { z } from "zod";
import { Input, SupplierContact } from "~/components/Form";
import { path } from "~/utils/path";
import type { PurchaseOrder } from "../../types";

const signatureRequestSchema = z.object({
  signerEmail: z.string().email("Please enter a valid email"),
  signerName: z.string().min(1, "Please enter a name"),
  emailSubject: z.string().optional()
});

const signatureRequestValidator = validator(signatureRequestSchema);

type PurchaseOrderSignatureModalProps = {
  purchaseOrder?: PurchaseOrder;
  supplierContactEmail?: string | null;
  supplierContactName?: string | null;
  onClose: () => void;
};

const PurchaseOrderSignatureModal = ({
  purchaseOrder,
  supplierContactEmail,
  supplierContactName,
  onClose
}: PurchaseOrderSignatureModalProps) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // First, fetch the PDF as base64
      const pdfResponse = await fetch(path.to.file.purchaseOrder(orderId));
      if (!pdfResponse.ok) {
        throw new Error("Failed to generate PDF");
      }

      const pdfBlob = await pdfResponse.blob();
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      // Send signature request
      const response = await fetch("/api/integrations/docusign/send-signature", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          purchaseOrderId: orderId,
          pdfBase64,
          signerEmail: formData.get("signerEmail"),
          signerName: formData.get("signerName"),
          emailSubject:
            formData.get("emailSubject") ||
            `Please sign Purchase Order ${purchaseOrder?.purchaseOrderId}`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send signature request");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
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
        <ValidatedForm
          method="post"
          validator={signatureRequestValidator}
          onSubmit={(_, e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleSubmit(formData);
          }}
          defaultValues={{
            signerEmail: supplierContactEmail ?? "",
            signerName: supplierContactName ?? "",
            emailSubject: `Please sign Purchase Order ${purchaseOrder?.purchaseOrderId}`
          }}
        >
          <ModalHeader>
            <ModalTitle>Request Signature</ModalTitle>
            <ModalDescription>
              Send {purchaseOrder?.purchaseOrderId} to DocuSign for electronic
              signature.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert variant="default">
                  <AlertDescription>
                    Signature request sent successfully!
                  </AlertDescription>
                </Alert>
              )}
              {!success && (
                <>
                  <Input
                    label="Signer Name"
                    name="signerName"
                    placeholder="Enter the signer's name"
                  />
                  <Input
                    label="Signer Email"
                    name="signerEmail"
                    type="email"
                    placeholder="Enter the signer's email"
                  />
                  <Input
                    label="Email Subject"
                    name="emailSubject"
                    placeholder="Email subject line"
                  />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              {success ? "Close" : "Cancel"}
            </Button>
            {!success && (
              <Button type="submit" isLoading={isSubmitting}>
                Send for Signature
              </Button>
            )}
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseOrderSignatureModal;
