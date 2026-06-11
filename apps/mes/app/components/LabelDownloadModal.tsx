import {
  Badge,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuDownload } from "react-icons/lu";

type FileRoutes = {
  pdf: (id: string, opts?: { labelSize?: string }) => string;
  zpl: (id: string, opts?: { labelSize?: string }) => string;
};

export function LabelDownloadModal({
  sourceDocumentId,
  fileRoutes,
  isOpen,
  onClose
}: {
  sourceDocumentId: string;
  fileRoutes: FileRoutes;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  const zplSizes = labelSizes.filter((s) => s.zpl);
  const pdfSizes = labelSizes;

  const openFile = (url: string) => {
    window.open(window.location.origin + url, "_blank");
    onClose();
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Download Labels</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-1 pb-4">
            {zplSizes.map((size) => (
              <button
                type="button"
                key={`zpl-${size.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted transition-colors text-left"
                onClick={() =>
                  openFile(
                    fileRoutes.zpl(sourceDocumentId, { labelSize: size.id })
                  )
                }
              >
                <LuDownload className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{size.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {size.description}
                  </span>
                </div>
                <Badge variant="green">ZPL</Badge>
              </button>
            ))}
            {pdfSizes.map((size) => (
              <button
                type="button"
                key={`pdf-${size.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted transition-colors text-left"
                onClick={() =>
                  openFile(
                    fileRoutes.pdf(sourceDocumentId, { labelSize: size.id })
                  )
                }
              >
                <LuDownload className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{size.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {size.description}
                  </span>
                </div>
                <Badge variant="blue">PDF</Badge>
              </button>
            ))}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
