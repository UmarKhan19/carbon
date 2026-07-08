import {
  Count,
  cn,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  ScrollArea,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { LuChevronRight, LuSearch } from "react-icons/lu";
import type { ChangeOrderImpactItem } from "~/modules/items";
import type { MethodItemType } from "~/modules/shared";
import type { UsedInKey, UsedInNode } from "../Item/UsedIn";
import { UsedInItem } from "../Item/UsedIn";

// The change-order "Used In" explorer tab. Mirrors the Item Master left-panel
// "Used In" tree, but keyed to the change order's affected items: each affected
// item is a collapsible group whose children are the jobs, purchase orders,
// sales orders, and parent BOMs that reference it today — the same blast radius
// a release touches. Rows reuse the shared `UsedInItem` renderer (identical look
// + link resolution) fed from `getChangeOrderImpact`.
export default function ChangeOrderUsedIn({
  impact
}: {
  impact: ChangeOrderImpactItem[];
}) {
  const { t } = useLingui();
  const [filterText, setFilterText] = useState("");

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
          {impact.length === 0 ? (
            <div className="flex h-8 items-center px-2">
              <span className="text-xs text-muted-foreground">
                <Trans>No affected items yet</Trans>
              </span>
            </div>
          ) : (
            impact.map((item) => (
              <UsedInItemGroup
                key={item.itemId}
                item={item}
                filterText={filterText}
              />
            ))
          )}
        </VStack>
      </VStack>
    </ScrollArea>
  );
}

function UsedInItemGroup({
  item,
  filterText
}: {
  item: ChangeOrderImpactItem;
  filterText: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const nodes = buildUsedInNodes(item);
  const itemLabel = item.itemReadableId ?? item.itemId;

  return (
    <>
      <button
        type="button"
        className="flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-sm px-2 text-sm font-medium hover:bg-accent"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="flex h-8 w-4 items-center justify-center">
          <LuChevronRight className={cn("size-4", isExpanded && "rotate-90")} />
        </div>
        <AiOutlinePartition className="shrink-0" />
        <span className="flex-grow truncate text-left">{itemLabel}</span>
        <Count count={nodes.reduce((n, node) => n + node.children.length, 0)} />
      </button>
      {isExpanded && (
        <div className="flex w-full flex-col pl-4">
          {nodes.map((node) => (
            <UsedInItem
              key={node.key}
              node={node}
              filterText={filterText}
              itemReadableIdWithRevision={itemLabel}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Map a change order's per-item impact into the shared UsedInNode shape. Keys +
// child ids are chosen so the shared `getUseInLink` (inside UsedInItem) resolves
// a real link: jobs by job id, PO/SO by parent-document id, parent BOMs by the
// parent item id (grouped by parent type so each links to the right detail page).
function buildUsedInNodes(item: ChangeOrderImpactItem): UsedInNode[] {
  const nodes: UsedInNode[] = [
    {
      key: "jobs",
      name: "Jobs",
      module: "production",
      children: item.jobs.map((c) => ({
        id: c.id,
        documentReadableId: c.documentReadableId ?? "—"
      }))
    },
    {
      key: "purchaseOrderLines",
      name: "Purchase Orders",
      module: "purchasing",
      children: item.purchaseOrderLines.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentReadableId: c.documentReadableId ?? "—"
      }))
    },
    {
      key: "salesOrderLines",
      name: "Sales Orders",
      module: "sales",
      children: item.salesOrderLines.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentReadableId: c.documentReadableId ?? "—"
      }))
    }
  ];

  // Parent BOMs link to the parent item's detail page. Group by parent item type
  // so a Part parent links to partDetails, a Tool parent to toolDetails, etc.
  const parentsByType = new Map<MethodItemType, UsedInNode["children"]>();
  for (const c of item.parentBoms) {
    const type = (c.itemType ?? "Part") as MethodItemType;
    const list = parentsByType.get(type) ?? [];
    list.push({
      id: c.documentId ?? c.id,
      documentReadableId: c.documentReadableId ?? "—"
    });
    parentsByType.set(type, list);
  }
  if (parentsByType.size === 0) {
    nodes.push({
      key: "Part",
      name: "Parent BOMs",
      module: "parts",
      children: []
    });
  } else {
    for (const [type, children] of parentsByType) {
      nodes.push({
        key: type as UsedInKey,
        name: "Parent BOMs",
        module: "parts",
        children
      });
    }
  }

  return nodes;
}
