import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { receiptStatusType } from "~/modules/inventory";

type ReceiptStatusProps = {
  status?: (typeof receiptStatusType)[number] | null;
};

const ReceiptStatus = ({ status }: ReceiptStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Pending":
      return (
        <Status color="orange">
          <Trans>Pending</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color="green">
          <Trans>Posted</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ReceiptStatus;
