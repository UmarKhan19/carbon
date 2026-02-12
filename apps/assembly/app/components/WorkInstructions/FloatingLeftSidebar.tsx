import { cn } from "@carbon/react";
import { useState } from "react";
import {
  BsChevronLeft,
  BsChevronRight,
  BsDiagram3,
  BsListOl
} from "react-icons/bs";
import type { AssemblyStep, AssemblyTreeNode } from "~/types/assembly.types";
import { ComponentTree } from "./LeftPanel/ComponentTree";
import { GeometriesList } from "./LeftPanel/GeometriesList";
import { StepTree } from "./LeftPanel/StepTree";

export interface FloatingLeftSidebarProps {
  steps: AssemblyStep[];
  assemblyTree: AssemblyTreeNode;
  selectedStepIndex: number;
  onStepSelect: (index: number) => void;
  onStepsReorder?: (fromIndex: number, toIndex: number) => void;
  onNodeSelect?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

export function FloatingLeftSidebar({
  steps,
  assemblyTree,
  selectedStepIndex,
  onStepSelect,
  onStepsReorder,
  onNodeSelect,
  selectedNodeId
}: FloatingLeftSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"model" | "instructions">(
    "instructions"
  );

  const geometryCounts = countGeometries(assemblyTree);

  return (
    <div className="flex-shrink-0 flex h-full">
      {/* Sidebar panel */}
      <div
        className={cn(
          "bg-background border-r border-border flex flex-col h-full transition-[width] duration-200 ease-in-out overflow-hidden",
          isCollapsed ? "w-0 border-r-0" : "w-72"
        )}
      >
        {/* Tab Headers */}
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setActiveTab("model")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-colors",
              activeTab === "model"
                ? "bg-muted text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <BsDiagram3 className="w-4 h-4" />
            Parts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("instructions")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-colors",
              activeTab === "instructions"
                ? "bg-muted text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <BsListOl className="w-4 h-4" />
            Steps
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === "model" ? (
            <ComponentTree
              tree={assemblyTree}
              onNodeSelect={onNodeSelect}
              selectedNodeId={selectedNodeId}
            />
          ) : (
            <StepTree
              steps={steps}
              selectedStepIndex={selectedStepIndex}
              onStepSelect={onStepSelect}
              onStepsReorder={onStepsReorder}
            />
          )}
        </div>

        {/* Geometries Section (always visible at bottom) */}
        <GeometriesList geometries={geometryCounts} />
      </div>

      {/* Toggle button — always visible */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "flex items-center justify-center w-5 h-10 self-center rounded-r-md transition-colors",
          "bg-muted border border-l-0 border-border",
          "hover:bg-muted/80 text-muted-foreground hover:text-foreground"
        )}
        title={isCollapsed ? "Show sidebar" : "Hide sidebar"}
      >
        {isCollapsed ? (
          <BsChevronRight className="w-3 h-3" />
        ) : (
          <BsChevronLeft className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

function countGeometries(
  node: AssemblyTreeNode,
  counts: Record<string, number> = {}
): Record<string, number> {
  if (node.type === "part") {
    const name = node.name || node.originalName;
    counts[name] = (counts[name] || 0) + (node.quantity || 1);
  }

  if (node.children) {
    for (const child of node.children) {
      countGeometries(child, counts);
    }
  }

  return counts;
}
