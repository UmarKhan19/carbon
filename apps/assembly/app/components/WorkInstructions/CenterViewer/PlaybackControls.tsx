import { cn } from "@carbon/react";
import type { AssemblyStep } from "~/types/assembly.types";

export interface PlaybackControlsProps {
  steps: AssemblyStep[];
  currentStep?: AssemblyStep;
  selectedStepIndex: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkipToStart: () => void;
  onSkipToEnd: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onStepSelect: (index: number) => void;
}

export function PlaybackControls({
  steps,
  currentStep,
  selectedStepIndex,
  isPlaying,
  onPlay,
  onPause,
  onSkipToStart,
  onSkipToEnd,
  onPrevious,
  onNext,
  onStepSelect
}: PlaybackControlsProps) {
  const atStart = selectedStepIndex === 0;
  const atEnd = selectedStepIndex === steps.length - 1;
  const stepLabel = currentStep
    ? currentStep.title || currentStep.partNames.join(", ")
    : "";

  return (
    <div className="bg-card border-t border-border px-3 py-1.5 flex items-center gap-3">
      {/* Step info */}
      <div className="text-xs text-muted-foreground whitespace-nowrap min-w-[80px]">
        <span className="font-medium text-foreground">
          {selectedStepIndex + 1}/{steps.length}
        </span>
        {stepLabel && (
          <span className="ml-1.5 truncate max-w-[160px] inline-block align-bottom">
            {stepLabel}
          </span>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onSkipToStart}
          disabled={atStart}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors",
            atStart
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Skip to start"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={onPrevious}
          disabled={atStart}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors",
            atStart
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Previous step"
        >
          ⏪
        </button>
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          className={cn(
            "w-7 h-7 flex items-center justify-center rounded-full transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          title={isPlaying ? "Pause" : "Play"}
        >
          <span className="text-sm">{isPlaying ? "⏸" : "▶"}</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={atEnd}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors",
            atEnd
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Next step"
        >
          ⏩
        </button>
        <button
          type="button"
          onClick={onSkipToEnd}
          disabled={atEnd}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors",
            atEnd
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Skip to end"
        >
          ⏭
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 relative h-1.5 bg-muted rounded-full overflow-hidden">
        {/* Progress */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-primary transition-all"
          style={{
            width: `${((selectedStepIndex + 1) / steps.length) * 100}%`
          }}
        />

        {/* Step Markers */}
        <div className="absolute inset-0 flex">
          {steps.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onStepSelect(index)}
              className="flex-1 relative group"
            >
              <div
                className={cn(
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                  "w-2 h-2 rounded-full border transition-all",
                  index <= selectedStepIndex
                    ? "bg-primary border-primary"
                    : "bg-muted border-muted-foreground/30",
                  index === selectedStepIndex && "ring-1 ring-primary/30"
                )}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="bg-popover text-popover-foreground text-xs rounded px-2 py-1 shadow-lg whitespace-nowrap">
                  Step {index + 1}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
