import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { shipmentStatusType } from "~/modules/inventory";

type ShipmentStatusProps = {
  status?: (typeof shipmentStatusType)[number] | null;
  invoiced?: boolean | null;
  voided?: boolean | null;
};

const ShipmentStatus = ({ status, invoiced, voided }: ShipmentStatusProps) => {
  if (invoiced && status !== "Voided") {
    return (
      <Status color="blue">
        <Trans>Invoiced</Trans>
      </Status>
    );
  }
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
    case "Voided":
      return (
        <Status color="red">
          <Trans>Voided</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ShipmentStatus;
