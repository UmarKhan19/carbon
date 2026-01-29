import { cn } from "@carbon/react";
import { useState } from "react";
import { BsChevronDown, BsChevronRight } from "react-icons/bs";
import type { AssemblyStep } from "~/types/assembly.types";

export interface StepTreeProps {
  steps: AssemblyStep[];
  selectedStepIndex: number;
  onStepSelect: (index: number) => void;
  onStepsReorder?: (fromIndex: number, toIndex: number) => void;
}

export function StepTree({
  steps,
  selectedStepIndex,
  onStepSelect,
  onStepsReorder
}: StepTreeProps) {
  // Group steps by their parent (for hierarchical display)
  const groupedSteps = groupStepsByHierarchy(steps);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="py-2">
        {groupedSteps.map((group, groupIndex) => (
          <StepGroup
            key={group.groupId || `group-${groupIndex}`}
            group={group}
            steps={steps}
            selectedStepIndex={selectedStepIndex}
            onStepSelect={onStepSelect}
          />
        ))}
      </div>
    </div>
  );
}

interface StepGroupData {
  groupId: string | null;
  groupLabel?: string;
  steps: { step: AssemblyStep; index: number }[];
  children: StepGroupData[];
}

function StepGroup({
  group,
  steps,
  selectedStepIndex,
  onStepSelect,
  depth = 0
}: {
  group: StepGroupData;
  steps: AssemblyStep[];
  selectedStepIndex: number;
  onStepSelect: (index: number) => void;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = group.children.length > 0;

  return (
    <div>
      {/* Group header (if has label) */}
      {group.groupLabel && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren &&
            (isExpanded ? (
              <BsChevronDown className="w-3 h-3" />
            ) : (
              <BsChevronRight className="w-3 h-3" />
            ))}
          {group.groupLabel}
        </button>
      )}

      {/* Steps in this group */}
      {(isExpanded || !group.groupLabel) && (
        <>
          {group.steps.map(({ step, index }) => (
            <StepTreeItem
              key={step.id}
              step={step}
              index={index}
              isSelected={index === selectedStepIndex}
              onSelect={() => onStepSelect(index)}
              depth={depth}
            />
          ))}

          {/* Nested groups */}
          {group.children.map((childGroup, childIndex) => (
            <StepGroup
              key={childGroup.groupId || `child-${childIndex}`}
              group={childGroup}
              steps={steps}
              selectedStepIndex={selectedStepIndex}
              onStepSelect={onStepSelect}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface StepTreeItemProps {
  step: AssemblyStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  depth: number;
}

function StepTreeItem({
  step,
  index,
  isSelected,
  onSelect,
  depth
}: StepTreeItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left py-2 px-3 transition-colors border-l-2 flex items-start gap-2",
        isSelected
          ? "bg-primary/10 border-l-primary text-foreground"
          : "border-l-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground"
      )}
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
    >
      {/* Step number badge */}
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-[32px] px-1.5 py-0.5 text-xs font-mono rounded",
          isSelected
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {step.stepNumber}
      </span>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">
          {step.title || `Step ${step.stepNumber}`}
        </div>
        {step.partNames.length > 0 && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {formatPartNames(step.partNames)}
          </div>
        )}
      </div>

      {/* Warning indicator */}
      {step.warnings.length > 0 && (
        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-yellow-500" />
      )}
    </button>
  );
}

// Helper to format part names
function formatPartNames(partNames: string[]): string {
  if (partNames.length === 0) return "";
  if (partNames.length === 1) return partNames[0];
  if (partNames.length === 2) return partNames.join(", ");
  return `${partNames[0]}, ${partNames[1]} +${partNames.length - 2} more`;
}

// Helper to group steps into hierarchy
function groupStepsByHierarchy(steps: AssemblyStep[]): StepGroupData[] {
  // For now, just create a flat list
  // In a full implementation, this would parse stepNumber (1.1, 1.2.1, etc.)
  // and create nested groups

  const rootGroup: StepGroupData = {
    groupId: null,
    steps: steps.map((step, index) => ({ step, index })),
    children: []
  };

  // Group by groupLabel if present
  const groupedByLabel = new Map<string, StepGroupData>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = step.groupLabel;

    if (label) {
      if (!groupedByLabel.has(label)) {
        groupedByLabel.set(label, {
          groupId: label,
          groupLabel: label,
          steps: [],
          children: []
        });
      }
      groupedByLabel.get(label)!.steps.push({ step, index: i });
    }
  }

  // If we have groups, return them
  if (groupedByLabel.size > 0) {
    // Include ungrouped steps first
    const ungrouped = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => !step.groupLabel);

    const result: StepGroupData[] = [];

    if (ungrouped.length > 0) {
      result.push({
        groupId: null,
        steps: ungrouped,
        children: []
      });
    }

    for (const group of groupedByLabel.values()) {
      result.push(group);
    }

    return result;
  }

  // Otherwise return flat list
  return [rootGroup];
}
