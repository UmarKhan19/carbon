import {
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
  useDisclosure,
  VStack
} from "@carbon/react";
import { LuCopy, LuEllipsisVertical, LuTrash } from "react-icons/lu";
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

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  const priceList = routeData?.priceList;
  if (!priceList) return null;

  const permissionModule =
    priceList.type === "Purchase" ? "purchasing" : "sales";
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
