import { Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { Item } from "~/components/Form";
import { path } from "~/utils/path";

// Disposition badge + add-affected-item modal (the list lives in ChangeOrderItemsTree).

export function DispositionStatus({ disposition }: { disposition: string }) {
  switch (disposition) {
    case "No Change":
      return <Status color="gray">No Change</Status>;
    case "Use Up":
      return <Status color="blue">Use Up</Status>;
    case "Rework":
      return <Status color="yellow">Rework</Status>;
    case "Scrap":
      return <Status color="red">Scrap</Status>;
    default:
      return <Status color="gray">{disposition}</Status>;
  }
}

export function AddAffectedItemModal({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const fetcher = useFetcher<{ error?: { message: string } | null }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.error) {
        toast.error(fetcher.data.error.message);
      } else {
        onClose();
      }
    }
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.updateChangeOrderItem}
          validator={z.object({ itemId: z.string().min(1) })}
          fetcher={fetcher}
        >
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="changeOrderId" value={id} />
          <ModalHeader>
            <ModalTitle>
              <Trans>Add affected item</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Item name="itemId" label={t`Item`} type="Item" />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit isLoading={fetcher.state !== "idle"}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
