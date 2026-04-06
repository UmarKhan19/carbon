import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useEffect } from "react";
import {
  LuCircleCheck,
  LuCopy,
  LuEllipsisVertical,
  LuFiles,
  LuPause,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail } from "../types";

const PriceListHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("Price list ID not found");

  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const versionFetcher = useFetcher();
  const duplicateFetcher = useFetcher();
  const statusFetcher = useFetcher<{
    error?: { message: string };
    data?: unknown;
  }>();

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  // Surface overlap or other errors from the update route
  useEffect(() => {
    if (statusFetcher.data?.error) {
      toast.error(statusFetcher.data.error.message);
    }
  }, [statusFetcher.data]);

  const priceList = routeData?.priceList;
  if (!priceList) return null;

  const status = priceList.status;
  const permissionModule =
    priceList.type === "Purchase" ? "purchasing" : "sales";
  const canUpdate = permissions.can("update", permissionModule);
  const listPath =
    priceList.type === "Sales"
      ? path.to.salesPriceLists
      : path.to.purchasePriceLists;

  const handleCreateVersion = () => {
    versionFetcher.submit(null, {
      method: "post",
      action: path.to.priceListVersions(id)
    });
  };

  const handleDuplicate = () => {
    duplicateFetcher.submit(null, {
      method: "post",
      action: path.to.priceListDuplicate(id)
    });
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <VStack spacing={0} className="flex-grow">
          <HStack>
            <Link to={path.to.priceListItems(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{priceList.name}</span>
              </Heading>
            </Link>
            <Enumerable value={priceList.status} />
            <Copy text={priceList.name} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={handleCreateVersion}>
                  <DropdownMenuIcon icon={<LuCopy />} />
                  Create New Version
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate}>
                  <DropdownMenuIcon icon={<LuFiles />} />
                  Duplicate Price List
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!permissions.can("delete", permissionModule)}
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Price List
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack>
          {status === "Draft" && (
            <statusFetcher.Form method="post" action={path.to.updatePriceList}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="field" value="status" />
              <input type="hidden" name="value" value="Active" />
              <Button
                type="submit"
                leftIcon={<LuCircleCheck />}
                variant="primary"
                isDisabled={!canUpdate || statusFetcher.state !== "idle"}
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("value") === "Active"
                }
              >
                Activate
              </Button>
            </statusFetcher.Form>
          )}

          {status === "Active" && (
            <statusFetcher.Form method="post" action={path.to.updatePriceList}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="field" value="status" />
              <input type="hidden" name="value" value="Draft" />
              <Button
                type="submit"
                leftIcon={<LuPause />}
                variant="secondary"
                isDisabled={!canUpdate || statusFetcher.state !== "idle"}
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("value") === "Draft"
                }
              >
                Deactivate
              </Button>
            </statusFetcher.Form>
          )}

          {(status === "Expired" || status === "Archived") && (
            <statusFetcher.Form method="post" action={path.to.updatePriceList}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="field" value="status" />
              <input type="hidden" name="value" value="Draft" />
              <Button
                type="submit"
                leftIcon={<LuRotateCcw />}
                variant="secondary"
                isDisabled={!canUpdate || statusFetcher.state !== "idle"}
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("value") === "Draft"
                }
              >
                Reopen
              </Button>
            </statusFetcher.Form>
          )}
        </HStack>
      </div>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={`${listPath}/delete/${id}`}
          name={priceList.name}
          text={`Are you sure you want to delete the price list "${priceList.name}"? This will also delete all items, rules, and assignments. This cannot be undone.`}
          onCancel={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default PriceListHeader;
