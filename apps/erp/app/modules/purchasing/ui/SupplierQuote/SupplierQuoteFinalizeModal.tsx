import { ValidatedForm } from "@carbon/form";
import {
  Button,
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
import type { FetcherWithComponents } from "react-router";
import { SelectControlled, SupplierContact } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { supplierQuoteFinalizeValidator } from "../../purchasing.models";
import type { SupplierQuote } from "../../types";

type SupplierQuoteFinalizeModalProps = {
  onClose: () => void;
  quote?: SupplierQuote;
  fetcher: FetcherWithComponents<{}>;
  action: string;
};

const SupplierQuoteFinalizeModal = ({
  quote,
  onClose,
  fetcher,
  action
}: SupplierQuoteFinalizeModalProps) => {
  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "None"
  );

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
          validator={supplierQuoteFinalizeValidator}
          action={action}
          onSubmit={onClose}
          defaultValues={{
            // @ts-expect-error TS2322 - TODO: fix type
            notification: notificationType as "Email" | "None",
            supplierContact: quote?.supplierContactId ?? undefined
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Send {quote?.supplierQuoteId}</ModalTitle>
            <ModalDescription>
              Send the supplier quote to the supplier via email.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {canEmail && (
                <SelectControlled
                  label="Send Via"
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None"
                    },
                    {
                      label: "Email",
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <SupplierContact
                  name="supplierContact"
                  supplier={quote?.supplierId ?? undefined}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Send</Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SupplierQuoteFinalizeModal;
