import { cn } from "@carbon/react";
import type { AssemblyStep } from "~/types/assembly.types";

export interface StepNavigationProps {
  currentStep?: AssemblyStep;
  stepIndex: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function StepNavigation({
  currentStep,
  stepIndex,
  totalSteps,
  onPrevious,
  onNext
}: StepNavigationProps) {
  const hasPrevious = stepIndex > 0;
  const hasNext = stepIndex < totalSteps - 1;

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10">
      <div className="bg-card/95 backdrop-blur-sm rounded-lg border border-border shadow-lg flex items-center gap-1 p-1">
        {/* Previous Button */}
        <button
          type="button"
          onClick={onPrevious}
          disabled={!hasPrevious}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            hasPrevious
              ? "hover:bg-muted text-muted-foreground hover:text-foreground"
              : "text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          ◀
        </button>

        {/* Step Info */}
        <div className="px-4 py-1 min-w-[200px] text-center">
          <div className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {totalSteps}
          </div>
          {currentStep && (
            <div className="text-sm font-medium truncate max-w-[300px]">
              [{currentStep.stepNumber}]{" "}
              {currentStep.title || currentStep.partNames.join(", ")}
            </div>
          )}
        </div>

        {/* Next Button */}
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            hasNext
              ? "hover:bg-muted text-muted-foreground hover:text-foreground"
              : "text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
