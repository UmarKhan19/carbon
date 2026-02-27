import { Button, cn } from "@carbon/react";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuFilePlus,
  LuFolder,
  LuFolderOpen
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
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
  const navigate = useNavigate();

  const tree = useMemo(() => accountsToFlatTree(data), [data]);

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    selectNode,
    toggleExpandNode,
    expandAllBelowDepth,
    collapseAllBelowDepth,
    virtualizer
  } = useTree<Chart, undefined>({
    tree,
    parentRef,
    estimatedRowHeight: () => 36
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
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
                  "flex h-9 cursor-pointer items-center overflow-hidden pr-4 text-sm group/row",
                  state.selected
                    ? "bg-muted hover:bg-accent"
                    : "bg-transparent hover:bg-accent",
                  isGroup && "font-semibold"
                )}
                onClick={() => {
                  selectNode(node.id, false);
                  if (isGroup) {
                    toggleExpandNode(node.id);
                  } else {
                    navigate(account.id as string);
                  }
                }}
              >
                {/* Indentation lines */}
                <div className="flex h-9 items-center">
                  {Array.from({ length: node.level }).map((_, index) => (
                    <LevelLine key={index} isSelected={state.selected} />
                  ))}

                  {/* Expand/collapse chevron */}
                  <div
                    className={cn(
                      "flex h-9 w-5 items-center justify-center",
                      node.hasChildren && "hover:bg-accent"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpandNode(node.id);
                    }}
                  >
                    {node.hasChildren ? (
                      isExpanded ? (
                        <LuChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <LuChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )
                    ) : (
                      <div className="h-9 w-5" />
                    )}
                  </div>
                </div>

                {/* Folder/dot icon */}
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

                {/* Account number + name */}
                <div className="flex flex-1 items-center gap-2 overflow-hidden">
                  <span className="text-muted-foreground shrink-0 w-16">
                    {account.number}
                  </span>
                  <span className="truncate">{account.name}</span>
                </div>

                {/* Balance */}
                <span className="w-32 text-right tabular-nums shrink-0 text-muted-foreground">
                  {formatCurrency(account.balance ?? 0)}
                </span>

                {/* Add child (groups only) */}
                {isGroup && (
                  <Button
                    asChild
                    isIcon
                    variant="ghost"
                    size="sm"
                    className="ml-1 shrink-0 opacity-0 group-hover/row:opacity-100"
                    aria-label="Add child account"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link to={`new?parentId=${account.id}`}>
                      <LuFilePlus className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
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
