import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type TrackedEntityStatusProps = {
  status?: Database["public"]["Enums"]["trackedEntityStatus"] | null;
};

function TrackedEntityStatus({ status }: TrackedEntityStatusProps) {
  switch (status) {
    case "Available":
      return (
        <Status color="green">
          <Trans>Available</Trans>
        </Status>
      );
    case "Reserved":
      return (
        <Status color="gray">
          <Trans>Reserved</Trans>
        </Status>
      );
    case "On Hold":
      return (
        <Status color="red">
          <Trans>On Hold</Trans>
        </Status>
      );
    case "Consumed":
      return (
        <Status color="blue">
          <Trans>Consumed</Trans>
        </Status>
      );
    default:
      return null;
  }
}

export default TrackedEntityStatus;
