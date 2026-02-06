import { cn } from "@carbon/react";
import { useState } from "react";
import {
  BsBox,
  BsChevronDown,
  BsChevronRight,
  BsCollection
} from "react-icons/bs";
import type { AssemblyTreeNode } from "~/types/assembly.types";

export interface ComponentTreeProps {
  tree: AssemblyTreeNode;
  onNodeSelect?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

export function ComponentTree({
  tree,
  onNodeSelect,
  selectedNodeId
}: ComponentTreeProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="py-2">
        <ComponentTreeNode
          node={tree}
          depth={0}
          onNodeSelect={onNodeSelect}
          selectedNodeId={selectedNodeId}
        />
      </div>
    </div>
  );
}

interface ComponentTreeNodeProps {
  node: AssemblyTreeNode;
  depth: number;
  onNodeSelect?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

function ComponentTreeNode({
  node,
  depth,
  onNodeSelect,
  selectedNodeId
}: ComponentTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2); // Auto-expand first 2 levels
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNodeId === node.id;
  // Show folder icon only for assemblies with multiple children
  const showAsFolderIcon =
    node.type === "assembly" && node.children && node.children.length > 1;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) {
            setIsExpanded(!isExpanded);
          }
          onNodeSelect?.(node.id);
        }}
        className={cn(
          "w-full text-left py-1.5 px-2 transition-colors flex items-center gap-2",
          isSelected
            ? "bg-primary/10 text-foreground"
            : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          isExpanded ? (
            <BsChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <BsChevronRight className="w-3 h-3 flex-shrink-0" />
          )
        ) : (
          <span className="w-3" /> // Spacer for alignment
        )}

        {/* Type icon - folder for assemblies with >1 children, box for single parts */}
        {showAsFolderIcon ? (
          <BsCollection className="w-4 h-4 flex-shrink-0 text-yellow-500" />
        ) : (
          <BsBox className="w-4 h-4 flex-shrink-0 text-blue-500" />
        )}

        {/* Node name */}
        <span className="flex-1 truncate text-sm">{node.name}</span>

        {/* Quantity badge */}
        {node.quantity && node.quantity > 1 && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            x{node.quantity}
          </span>
        )}
      </button>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <ComponentTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onNodeSelect={onNodeSelect}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
