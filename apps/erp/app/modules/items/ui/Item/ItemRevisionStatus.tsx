import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { itemRevisionStatus } from "../../items.models";

type ItemRevisionStatusProps = {
  status?: (typeof itemRevisionStatus)[number] | null;
};

const ItemRevisionStatus = ({ status }: ItemRevisionStatusProps) => {
  switch (status) {
    case "Design":
      return (
        <Status color="gray">
          <Trans>Design</Trans>
        </Status>
      );
    case "Prototype":
      return (
        <Status color="yellow">
          <Trans>Prototype</Trans>
        </Status>
      );
    case "Production":
      return (
        <Status color="green">
          <Trans>Production</Trans>
        </Status>
      );
    case "Obsolete":
      return (
        <Status color="orange">
          <Trans>Obsolete</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ItemRevisionStatus;
