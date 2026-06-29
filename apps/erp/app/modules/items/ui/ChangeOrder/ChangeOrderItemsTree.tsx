import {
  Badge,
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
  LuListTree,
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
import type { Material, RedlineCounts } from "./RedlineDiff";

export type AffectedItemRedline = {
  counts: RedlineCounts;
  // Proposed-revision BOM materials, used to nest the method (BOM) under each
  // affected item. Operations (processes) are intentionally omitted.
  materials: Material[];
};

// The change-order affected-items sidebar. Mirrors the NCR association tree:
// a ScrollArea + search, a collapsible "Affected Items" group carrying an add
// button, and per-item navigable rows. Each row navigates to the focused
// per-item Before/After view, shows a "Rev A → B" signal + a +/−/~ redline
// badge, and nests its proposed method (BOM) as a child node.
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
  const [isExpanded, setIsExpanded] = useState(true);
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
                    redline={redlineByItemId[item.id]}
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
  toRevision,
  counts
}: {
  fromRevision?: string | null;
  toRevision?: string | null;
  counts?: RedlineCounts;
}) {
  const hasRevisionDelta = Boolean(toRevision) && fromRevision !== toRevision;
  const added = counts?.added ?? 0;
  const removed = counts?.removed ?? 0;
  const changed = counts?.changed ?? 0;

  if (!hasRevisionDelta && added + removed + changed === 0) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {hasRevisionDelta && (
        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          {fromRevision ?? "—"} → {toRevision}
        </span>
      )}
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

function AffectedItemNode({
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
  const materials = redline?.materials ?? [];
  const [isMethodExpanded, setIsMethodExpanded] = useState(false);

  return (
    <>
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
            counts={redline?.counts}
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

      {item.pendingItemId && (
        <div className="flex flex-col w-full pl-4">
          <button
            type="button"
            className="flex h-8 items-center overflow-hidden rounded-sm px-1 gap-2 text-sm w-full hover:bg-accent text-muted-foreground"
            onClick={() => setIsMethodExpanded((prev) => !prev)}
          >
            <LevelLine isSelected={false} />
            <div className="h-8 w-4 flex items-center justify-center shrink-0">
              <LuChevronRight
                className={cn("size-3.5", isMethodExpanded && "rotate-90")}
              />
            </div>
            <LuListTree className="shrink-0" />
            <span className="truncate">
              <Trans>Method</Trans>
            </span>
          </button>

          {isMethodExpanded && (
            <div className="flex flex-col w-full pl-4">
              {materials.length === 0 ? (
                <div className="flex h-8 items-center overflow-hidden rounded-sm px-1 gap-2">
                  <LevelLine isSelected={false} />
                  <span className="text-xs text-muted-foreground">
                    <Trans>No materials</Trans>
                  </span>
                </div>
              ) : (
                materials.map((material, index) => (
                  <div
                    key={material.key ?? `${material.itemId}-${index}`}
                    className="flex h-8 items-center overflow-hidden rounded-sm px-1 gap-2 text-sm whitespace-nowrap"
                    style={{ paddingLeft: (material.level ?? 0) * 12 }}
                  >
                    <LevelLine isSelected={false} />
                    <AiOutlinePartition className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-muted-foreground">
                      {material.itemReadableId ?? material.itemId}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
