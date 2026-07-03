import {
  Badge,
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
  LuCirclePlus,
  LuEllipsisVertical,
  LuSearch,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { ChangeOrderItem } from "~/modules/items";
import { path } from "~/utils/path";
import ItemRevisionStatus from "../Item/ItemRevisionStatus";
import { AddAffectedItemModal } from "./ChangeOrderItems";
import type { RedlineCounts } from "./RedlineDiff";

export type AffectedItemRedline = {
  counts: RedlineCounts;
};

// The change-order affected-items sidebar. A flat, navigable list — one row per
// affected item — with a search + add toolbar. Each row shows the item, its
// proposed revision status, and a compact +/−/~ redline signal, and navigates to
// the focused Before/After view. (The full BOM/method diff lives in that view,
// not nested here.)
export default function ChangeOrderItemsTree({
  changeOrderId,
  items,
  redlineByItemId,
  isDisabled = false
}: {
  changeOrderId: string;
  items: ChangeOrderItem[];
  redlineByItemId: Record<string, AffectedItemRedline>;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [filterText, setFilterText] = useState("");
  const addModal = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<ChangeOrderItem | null>(
    null
  );

  const canCreate = permissions.can("update", "production") && !isDisabled;
  const canDelete = permissions.can("delete", "production") && !isDisabled;

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
      <VStack spacing={0} className="px-2">
        <HStack className="w-full gap-1 py-2">
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
          {canCreate && (
            <IconButton
              aria-label={t`Add affected item`}
              size="sm"
              variant="secondary"
              icon={<LuCirclePlus />}
              onClick={addModal.onOpen}
            />
          )}
        </HStack>

        <VStack spacing={0} className="w-full">
          {filteredItems.length === 0 ? (
            <div className="flex h-8 items-center px-2">
              <span className="text-xs text-muted-foreground">
                <Trans>No affected items yet</Trans>
              </span>
            </div>
          ) : (
            filteredItems.map((item) => (
              <AffectedItemRow
                key={item.id}
                changeOrderId={changeOrderId}
                item={item}
                redline={redlineByItemId[item.id]}
                canDelete={canDelete}
                onDelete={onDelete}
              />
            ))
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

function RedlineBadges({ counts }: { counts?: RedlineCounts }) {
  const added = counts?.added ?? 0;
  const removed = counts?.removed ?? 0;
  const changed = counts?.changed ?? 0;
  if (added + removed + changed === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {added > 0 && (
        <Badge variant="green" className="px-1 py-0 text-[10px]">
          +{added}
        </Badge>
      )}
      {removed > 0 && (
        <Badge variant="red" className="px-1 py-0 text-[10px]">
          −{removed}
        </Badge>
      )}
      {changed > 0 && (
        <Badge variant="yellow" className="px-1 py-0 text-[10px]">
          ~{changed}
        </Badge>
      )}
    </div>
  );
}

function AffectedItemRow({
  changeOrderId,
  item,
  redline,
  canDelete,
  onDelete
}: {
  changeOrderId: string;
  item: ChangeOrderItem;
  redline?: AffectedItemRedline;
  canDelete: boolean;
  onDelete: (item: ChangeOrderItem) => void;
}) {
  const { t } = useLingui();
  const { coItemId } = useParams();
  const isActive = coItemId === item.id;

  return (
    <div className="group/affected relative flex w-full">
      <Link
        to={path.to.changeOrderItem(changeOrderId, item.id)}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-sm px-2 pr-8 text-sm hover:bg-accent",
          isActive && "bg-accent"
        )}
      >
        <AiOutlinePartition className="shrink-0 text-muted-foreground" />
        <span className="flex-grow truncate font-medium">
          {item.readableIdWithRevision}
        </span>
        <RedlineBadges counts={redline?.counts} />
        <ItemRevisionStatus status={item.revisionStatus} withHelp />
      </Link>
      {canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 shrink-0 text-foreground/70 opacity-0 hover:text-foreground group-hover/affected:opacity-100 data-[state=open]:opacity-100"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem destructive onSelect={() => onDelete(item)}>
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Remove from change order</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
