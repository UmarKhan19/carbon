import { Trans } from "@lingui/react/macro";
import { path } from "~/utils/path";
import DefaultAttachmentsPanel, {
  type DefaultAttachment
} from "./DefaultAttachmentsPanel";

type Props = {
  attachments: DefaultAttachment[];
};

export default function CompanyDefaultAttachmentsCard({ attachments }: Props) {
  return (
    <DefaultAttachmentsPanel
      attachments={attachments}
      storagePathPrefix="default-attachments/company"
      uploadAction={path.to.companyDefaultAttachments}
      deleteAction={path.to.companyDefaultAttachmentDelete}
      lockAction={path.to.companyDefaultAttachmentLock}
      fetcherKeyPrefix="company-default"
      title={<Trans>Default Attachments</Trans>}
      description={
        <Trans>
          Files attached here ride along on every purchase order email by
          default. Suppliers will receive them alongside the PO PDF.
        </Trans>
      }
    />
  );
}
