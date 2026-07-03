import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import type { itemRevisionStatus } from "../../items.models";

type ItemRevisionStatusValue = (typeof itemRevisionStatus)[number];

type ItemRevisionStatusProps = {
  status?: ItemRevisionStatusValue | null;
  // Show a tooltip explaining what the lifecycle stage means (instead of the
  // Status component's default tooltip, which just repeats the label).
  withHelp?: boolean;
};

const config: Record<
  ItemRevisionStatusValue,
  {
    color: ComponentProps<typeof Status>["color"];
    label: ReactNode;
    help: ReactNode;
  }
> = {
  Design: {
    color: "gray",
    label: <Trans>Design</Trans>,
    help: <Trans>Editable draft; becomes Production when released.</Trans>
  },
  Prototype: {
    color: "yellow",
    label: <Trans>Prototype</Trans>,
    help: <Trans>Being validated before production.</Trans>
  },
  Production: {
    color: "green",
    label: <Trans>Production</Trans>,
    help: <Trans>Released and locked; change via a change order.</Trans>
  },
  Obsolete: {
    color: "orange",
    label: <Trans>Obsolete</Trans>,
    help: <Trans>Superseded by a newer revision.</Trans>
  }
};

const ItemRevisionStatus = ({
  status,
  withHelp = false
}: ItemRevisionStatusProps) => {
  if (!status || !(status in config)) return null;
  const { color, label, help } = config[status];

  return (
    <Status color={color} tooltip={withHelp ? help : undefined}>
      {label}
    </Status>
  );
};

export default ItemRevisionStatus;
