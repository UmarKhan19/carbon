import {
  ActionMenu,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { IoMdAdd } from "react-icons/io";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Link } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { AccountCategory, AccountSubcategory } from "../../types";

type AccountCategoryDetailProps = {
  accountCategory: AccountCategory;
  accountSubcategories: AccountSubcategory[];
  onClose: () => void;
};

const AccountCategoryDetail = ({
  accountCategory,
  accountSubcategories,
  onClose
}: AccountCategoryDetailProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();

  const deleteModal = useDisclosure();
  const [selectedAccountSubcategory, setSelectedAccountSubcategory] =
    useState<AccountSubcategory | null>(null);

  const onDelete = (data?: AccountSubcategory) => {
    if (!data) return;
    setSelectedAccountSubcategory(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedAccountSubcategory(null);
    deleteModal.onClose();
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{accountCategory.category}</DrawerTitle>
            <DrawerDescription>
              {accountCategory.incomeBalance}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <VStack>
              {accountSubcategories.map((subcategory) => {
                return (
                  <HStack spacing={1} key={subcategory.id} className="w-full">
                    <p className="flex-grow">{subcategory.name}</p>
                    <ActionMenu>
                      <DropdownMenuItem asChild>
                        <Link to={`${subcategory.id}?${params.toString()}`}>
                          <DropdownMenuIcon icon={<LuPencil />} />
                          <Trans>Edit Subcategory</Trans>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDelete(subcategory)}>
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete Subcategory</Trans>
                      </DropdownMenuItem>
                    </ActionMenu>
                  </HStack>
                );
              })}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button asChild leftIcon={<IoMdAdd />}>
              <Link to={`new?${params.toString()}`}>
                <Trans>New Subcategory</Trans>
              </Link>
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {selectedAccountSubcategory && selectedAccountSubcategory.id && (
        <ConfirmDelete
          isOpen={deleteModal.isOpen}
          action={path.to.deleteAccountingSubcategory(
            selectedAccountSubcategory.id
          )}
          name={selectedAccountSubcategory?.name ?? ""}
          text={t`Are you sure you want to deactivate the ${selectedAccountSubcategory?.name} subcategory?`}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
};

export default AccountCategoryDetail;
