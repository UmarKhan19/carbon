import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { stockTransferStatusType } from "~/modules/inventory";

type StockTransferStatusProps = {
  status?: (typeof stockTransferStatusType)[number] | null;
};

const StockTransferStatus = ({ status }: StockTransferStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Released":
      return (
        <Status color="orange">
          <Trans>Released</Trans>
        </Status>
      );
    case "In Progress":
      return (
        <Status color="blue">
          <Trans>In Progress</Trans>
        </Status>
      );
    case "Completed":
      return (
        <Status color="green">
          <Trans>Completed</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default StockTransferStatus;
