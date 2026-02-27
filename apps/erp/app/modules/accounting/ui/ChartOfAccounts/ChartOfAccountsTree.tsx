import { Button, cn, HStack } from "@carbon/react";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronRight,
  LuEllipsisVertical,
  LuFilePlus,
  LuFolder,
  LuFolderOpen
} from "react-icons/lu";
import { Link as ReactRouterLink } from "react-router";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { TreeView, useTree } from "~/components/TreeView";
import { useRealtime } from "~/hooks";
import type { Chart } from "../../types";

type ChartOfAccountsTreeProps = {
  data: Chart[];
};

function accountsToFlatTree(accounts: Chart[]): FlatTree<Chart> {
  const byParent = new Map<string, Chart[]>();
  for (const a of accounts) {
    const key = a.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const result: FlatTreeItem<Chart>[] = [];

  function walk(parentId: string | null, level: number) {
    const children = byParent.get(parentId ?? "__root__") ?? [];
    for (const account of children) {
      const childAccounts = byParent.get(account.id) ?? [];
      const childIds = childAccounts.map((c) => c.id);
      result.push({
        id: account.id,
        parentId: parentId ?? undefined,
        children: childIds,
        hasChildren: childIds.length > 0,
        level,
        data: account
      });
      walk(account.id, level + 1);
    }
  }

  walk(null, 0);
  return result;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const ChartOfAccountsTree = memo(({ data }: ChartOfAccountsTreeProps) => {
  useRealtime("journal");
  const parentRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => accountsToFlatTree(data), [data]);

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    virtualizer,
    toggleExpandNode,
    expandAllBelowDepth,
    collapseAllBelowDepth
  } = useTree<Chart, undefined>({
    tree,
    parentRef,
    estimatedRowHeight: () => 36
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-card">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => expandAllBelowDepth(0)}
        >
          Expand All
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => collapseAllBelowDepth(0)}
        >
          Collapse All
        </Button>
      </div>
      <div className="flex flex-1 min-h-0 w-full">
        <TreeView<Chart>
          tree={tree}
          nodes={nodes}
          getTreeProps={getTreeProps}
          getNodeProps={getNodeProps}
          virtualizer={virtualizer}
          parentRef={parentRef}
          parentClassName="h-full"
          renderNode={({ node, state }) => {
            const account = node.data;
            const isGroup = account.isGroup;
            const isExpanded = state.expanded;

            return (
              <div
                className={cn(
                  "flex items-center h-9 px-4 hover:bg-muted/50 text-sm border-b border-border/50 cursor-pointer overflow-hidden",
                  isGroup && "font-semibold"
                )}
                style={{
                  paddingLeft: `calc(${node.level * 1.25}rem + 1rem)`
                }}
                onClick={() => {
                  if (isGroup) toggleExpandNode(node.id);
                }}
              >
                {/* Expand/collapse icon for groups */}
                <div className="w-5 h-5 flex items-center justify-center mr-1 shrink-0">
                  {isGroup ? (
                    <LuChevronRight
                      className={cn(
                        "h-4 w-4 transition-transform text-muted-foreground",
                        isExpanded && "rotate-90"
                      )}
                    />
                  ) : null}
                </div>

                {/* Folder/file icon */}
                <div className="w-5 h-5 flex items-center justify-center mr-2 shrink-0">
                  {isGroup ? (
                    isExpanded ? (
                      <LuFolderOpen className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <LuFolder className="h-4 w-4 text-muted-foreground" />
                    )
                  ) : (
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  )}
                </div>

                {/* Account number */}
                <div className="w-20 shrink-0 text-muted-foreground">
                  {account.number}
                </div>

                {/* Account name as link */}
                <ReactRouterLink
                  to={account.id as string}
                  className="flex-1 truncate mr-4 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {account.name}
                </ReactRouterLink>

                {/* Balance */}
                <div className="w-32 text-right tabular-nums shrink-0">
                  {formatCurrency(account.balance ?? 0)}
                </div>

                {/* Actions */}
                <HStack className="ml-2 shrink-0">
                  {isGroup && (
                    <Button
                      asChild
                      isIcon
                      variant="ghost"
                      size="sm"
                      aria-label="Add child account"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ReactRouterLink to={`new?parentId=${account.id}`}>
                        <LuFilePlus className="h-3.5 w-3.5" />
                      </ReactRouterLink>
                    </Button>
                  )}
                  <Button
                    asChild
                    isIcon
                    variant="ghost"
                    size="sm"
                    aria-label="Edit account"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ReactRouterLink to={`${account.id}`}>
                      <LuEllipsisVertical className="h-3.5 w-3.5" />
                    </ReactRouterLink>
                  </Button>
                </HStack>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
});

ChartOfAccountsTree.displayName = "ChartOfAccountsTree";
export default ChartOfAccountsTree;
