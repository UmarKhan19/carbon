import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuGitPullRequestArrow } from "react-icons/lu";
import { Link } from "react-router";
import type { OpenChangeOrder } from "~/modules/items";
import { path } from "~/utils/path";

// Advisory shown on part/tool pages while the item is attached to an open
// change order (Draft/In Review/Approved — see getOpenChangeOrderForItem).
// Links to the change order by its UUID `id`, never the readable id.
type UnderChangeOrderAlertProps = {
  changeOrder: OpenChangeOrder | null;
  className?: string;
};

const UnderChangeOrderAlert = ({
  changeOrder,
  className
}: UnderChangeOrderAlertProps) => {
  if (!changeOrder) return null;

  return (
    <Alert variant="warning" className={className}>
      <LuGitPullRequestArrow />
      <AlertTitle>
        <Trans>This item is under change order</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          Changes are being tracked by{" "}
          <Link
            to={path.to.changeOrder(changeOrder.id)}
            className="font-medium underline underline-offset-2"
          >
            {changeOrder.changeOrderId}
          </Link>{" "}
          ({changeOrder.status}).
        </Trans>
      </AlertDescription>
    </Alert>
  );
};

export default UnderChangeOrderAlert;
