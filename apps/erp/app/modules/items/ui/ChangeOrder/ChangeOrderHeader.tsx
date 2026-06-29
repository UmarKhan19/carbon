import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuEllipsisVertical,
  LuHistory,
  LuRocket,
  LuSend,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isChangeOrderLocked } from "../../changeOrder.models";
import type { ChangeOrderDetail } from "../../changeOrder.types";
import ChangeOrderDecisionModal from "./ChangeOrderDecisionModal";
import ChangeOrderStatus from "./ChangeOrderStatus";

const ChangeOrderHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    changeOrder: ChangeOrderDetail;
  }>(path.to.changeOrder(id));

  const status = routeData?.changeOrder?.status;
  const { t } = useLingui();
  const permissions = usePermissions();
  const statusFetcher = useFetcher<{}>();
  const releaseFetcher = useFetcher<{}>();
  const deleteChangeOrderModal = useDisclosure();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  const isLocked = isChangeOrderLocked(status);
  const canDecide =
    status === "In Review" && permissions.can("update", "production");

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <VStack spacing={0}>
          <HStack>
            <Link to={path.to.changeOrderDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.changeOrder?.changeOrderId}</span>
              </Heading>
            </Link>
            <ChangeOrderStatus status={status} />
            <Copy text={routeData?.changeOrder?.changeOrderId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <Link to={path.to.changeOrderDetails(id)}>
                    <DropdownMenuIcon icon={<LuHistory />} />
                    <Trans>Audit Log</Trans>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  disabled={
                    !permissions.can("delete", "production") ||
                    !permissions.is("employee") ||
                    isLocked
                  }
                  onClick={deleteChangeOrderModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Change Order</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack>
          <statusFetcher.Form
            method="post"
            action={path.to.changeOrderStatus(id)}
          >
            <input type="hidden" name="status" value="In Review" />
            <Button
              type="submit"
              leftIcon={<LuSend />}
              variant={status === "Draft" ? "primary" : "secondary"}
              isDisabled={
                status !== "Draft" ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "production")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "In Review"
              }
            >
              <Trans>Submit for Review</Trans>
            </Button>
          </statusFetcher.Form>

          <Button
            type="button"
            leftIcon={<LuCircleX />}
            variant="secondary"
            isDisabled={!canDecide}
            onClick={() => setDecision("reject")}
          >
            <Trans>Reject</Trans>
          </Button>

          <Button
            type="button"
            leftIcon={<LuCircleCheck />}
            variant={status === "In Review" ? "primary" : "secondary"}
            isDisabled={!canDecide}
            onClick={() => setDecision("approve")}
          >
            <Trans>Approve</Trans>
          </Button>

          <releaseFetcher.Form
            method="post"
            action={path.to.releaseChangeOrder(id)}
          >
            <Button
              type="submit"
              leftIcon={<LuRocket />}
              variant={status === "Approved" ? "primary" : "secondary"}
              isDisabled={
                status !== "Approved" ||
                releaseFetcher.state !== "idle" ||
                !permissions.can("update", "production")
              }
              isLoading={releaseFetcher.state !== "idle"}
            >
              <Trans>Release</Trans>
            </Button>
          </releaseFetcher.Form>
        </HStack>
      </div>
      {decision && (
        <ChangeOrderDecisionModal
          changeOrderId={id}
          decision={decision}
          onClose={() => setDecision(null)}
        />
      )}
      {deleteChangeOrderModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteChangeOrder(id)}
          isOpen={deleteChangeOrderModal.isOpen}
          name={routeData?.changeOrder?.changeOrderId!}
          text={t`Are you sure you want to delete ${routeData?.changeOrder
            ?.changeOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteChangeOrderModal.onClose();
          }}
          onSubmit={() => {
            deleteChangeOrderModal.onClose();
          }}
        />
      )}
    </>
  );
};

export default ChangeOrderHeader;
