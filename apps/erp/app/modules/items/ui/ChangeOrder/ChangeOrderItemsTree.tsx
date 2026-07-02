import {
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  ScrollArea,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuChevronRight,
  LuCirclePlus,
  LuEllipsisVertical,
  LuSearch,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { LevelLine } from "~/components/TreeView";
import { usePermissions } from "~/hooks";
import type { ChangeOrderItem } from "~/modules/items";
import { path } from "~/utils/path";
import { AddAffectedItemModal } from "./ChangeOrderItems";

// Affected-items sidebar: search + per-item rows linking to the focused view.
export default function ChangeOrderItemsTree({
  changeOrderId,
  items,
  isDisabled = false
}: {
  changeOrderId: string;
  items: ChangeOrderItem[];
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [filterText, setFilterText] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const addModal = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<ChangeOrderItem | null>(
    null
  );

  const canCreate = permissions.can("update", "parts") && !isDisabled;
  const canDelete = permissions.can("delete", "parts") && !isDisabled;

  const onDelete = (item: ChangeOrderItem) => {
    flushSync(() => {
      setSelectedItem(item);
    });
    deleteDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedItem(null);
    deleteDisclosure.onClose();
  };

  const filteredItems = items.filter((item) =>
    (item.readableIdWithRevision ?? "")
      .toLowerCase()
      .includes(filterText.toLowerCase())
  );

  return (
    <ScrollArea className="h-full">
      <VStack className="px-2">
        <HStack className="w-full py-2">
          <InputGroup size="sm" className="flex flex-grow">
            <InputLeftElement>
              <LuSearch className="h-4 w-4" />
            </InputLeftElement>
            <Input
              placeholder={t`Search...`}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </InputGroup>
        </HStack>
        <VStack spacing={0}>
          <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full hover:bg-accent">
            <button
              type="button"
              className="flex flex-grow cursor-pointer items-center overflow-hidden font-medium"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
            >
              <div className="h-8 w-4 flex items-center justify-center">
                <LuChevronRight
                  className={cn("size-4", isExpanded && "rotate-90")}
                />
              </div>
              <div className="flex flex-grow items-center justify-between gap-2">
                <span>
                  <Trans>Affected Items</Trans>
                </span>
                {filteredItems.length > 0 && (
                  <Count count={filteredItems.length} />
                )}
              </div>
            </button>
            {canCreate && (
              <IconButton
                aria-label={t`Add affected item`}
                size="sm"
                variant="ghost"
                icon={<LuCirclePlus />}
                className="ml-auto"
                onClick={addModal.onOpen}
              />
            )}
          </div>

          {isExpanded && (
            <div className="flex flex-col w-full px-2">
              {filteredItems.length === 0 ? (
                <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
                  <LevelLine isSelected={false} />
                  <div className="text-xs text-muted-foreground">
                    <Trans>No affected items yet</Trans>
                  </div>
                </div>
              ) : (
                filteredItems.map((item) => (
                  <AffectedItemNode
                    key={item.id}
                    changeOrderId={changeOrderId}
                    item={item}
                    canDelete={canDelete}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          )}
        </VStack>
      </VStack>

      {addModal.isOpen && <AddAffectedItemModal onClose={addModal.onClose} />}

      {deleteDisclosure.isOpen && selectedItem?.id && (
        <ConfirmDelete
          action={path.to.deleteChangeOrderItem(selectedItem.id)}
          name={selectedItem.readableIdWithRevision ?? ""}
          text={`Are you sure you want to remove ${
            selectedItem.readableIdWithRevision ?? "this item"
          } from the change order? Its proposed revision will be discarded.`}
          deleteText="Remove"
          isOpen={deleteDisclosure.isOpen}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </ScrollArea>
  );
}

function ChangeSignal({
  fromRevision,
  toRevision
}: {
  fromRevision?: string | null;
  toRevision?: string | null;
}) {
  const hasRevisionDelta = Boolean(toRevision) && fromRevision !== toRevision;
  if (!hasRevisionDelta) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
        {fromRevision ?? "—"} → {toRevision}
      </span>
    </div>
  );
}

function AffectedItemNode({
  changeOrderId,
  item,
  canDelete,
  onDelete
}: {
  changeOrderId: string;
  item: ChangeOrderItem;
  canDelete: boolean;
  onDelete: (item: ChangeOrderItem) => void;
}) {
  const { t } = useLingui();
  const { coItemId } = useParams();
  const isActive = coItemId === item.id;

  return (
    <div className="group/association relative flex w-full">
      <Link
        to={path.to.changeOrderItem(changeOrderId, item.id)}
        className={cn(
          "flex pr-7 h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-2 text-sm hover:bg-accent w-full font-medium whitespace-nowrap",
          isActive && "bg-accent"
        )}
      >
        <LevelLine isSelected={isActive} />
        <AiOutlinePartition className="shrink-0" />
        <span className="truncate flex-grow">
          {item.readableIdWithRevision}
        </span>
        <ChangeSignal
          fromRevision={item.revision}
          toRevision={item.pendingItem?.revision}
        />
      </Link>
      {canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 flex-shrink-0 opacity-0 group-hover/association:opacity-100 data-[state=open]:opacity-100 text-foreground/70 hover:text-foreground"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem destructive onSelect={() => onDelete(item)}>
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Association</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
