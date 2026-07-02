import {
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
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useParams } from "react-router";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { ChangeOrderDetail } from "~/modules/items";
import { isChangeOrderLocked } from "~/modules/items";
import { path } from "~/utils/path";
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
  const deleteChangeOrderModal = useDisclosure();

  const isLocked = isChangeOrderLocked(status);

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
                <DropdownMenuItem
                  destructive
                  disabled={
                    !permissions.can("delete", "parts") ||
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

        {/* Status-transition + release actions are not implemented yet. */}
      </div>
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
