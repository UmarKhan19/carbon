import { cn } from "@carbon/react";
import { BsDiagram3, BsListOl } from "react-icons/bs";
import type { AssemblyStep, AssemblyTreeNode } from "~/types/assembly.types";
import { ComponentTree } from "./ComponentTree";
import { GeometriesList } from "./GeometriesList";
import { StepTree } from "./StepTree";

export interface LeftPanelProps {
  steps: AssemblyStep[];
  assemblyTree: AssemblyTreeNode;
  selectedStepIndex: number;
  onStepSelect: (index: number) => void;
  activeTab: "model" | "instructions";
  onTabChange: (tab: "model" | "instructions") => void;
  onStepsReorder?: (fromIndex: number, toIndex: number) => void;
}

export function LeftPanel({
  steps,
  assemblyTree,
  selectedStepIndex,
  onStepSelect,
  activeTab,
  onTabChange,
  onStepsReorder
}: LeftPanelProps) {
  // Count geometries from tree
  const geometryCounts = countGeometries(assemblyTree);

  return (
    <div className="w-72 border-r border-border bg-background flex flex-col h-full">
      {/* Tab Headers */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => onTabChange("model")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-colors",
            activeTab === "model"
              ? "bg-muted text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <BsDiagram3 className="w-4 h-4" />
          Model
        </button>
        <button
          type="button"
          onClick={() => onTabChange("instructions")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium transition-colors",
            activeTab === "instructions"
              ? "bg-muted text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <BsListOl className="w-4 h-4" />
          Instructions
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "model" ? (
          <ComponentTree tree={assemblyTree} />
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
  );
}

// Helper function to count part geometries
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
