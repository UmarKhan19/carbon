import { cn } from "@carbon/react";
import type { AssemblyStep } from "~/types/assembly.types";

export interface PlaybackControlsProps {
  steps: AssemblyStep[];
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
  return (
    <div className="bg-card/95 backdrop-blur-sm border-t border-border p-3">
      {/* Timeline */}
      <div className="mb-3">
        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
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
                    "w-3 h-3 rounded-full border-2 transition-all",
                    index <= selectedStepIndex
                      ? "bg-primary border-primary"
                      : "bg-muted border-muted-foreground/30",
                    index === selectedStepIndex && "ring-2 ring-primary/30"
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

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {/* Skip to Start */}
        <button
          type="button"
          onClick={onSkipToStart}
          disabled={selectedStepIndex === 0}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            selectedStepIndex === 0
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Skip to start"
        >
          ⏮
        </button>

        {/* Previous */}
        <button
          type="button"
          onClick={onPrevious}
          disabled={selectedStepIndex === 0}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            selectedStepIndex === 0
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Previous step"
        >
          ⏪
        </button>

        {/* Play/Pause */}
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          className={cn(
            "w-12 h-12 flex items-center justify-center rounded-full transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          title={isPlaying ? "Pause" : "Play"}
        >
          <span className="text-xl">{isPlaying ? "⏸" : "▶"}</span>
        </button>

        {/* Next */}
        <button
          type="button"
          onClick={onNext}
          disabled={selectedStepIndex === steps.length - 1}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            selectedStepIndex === steps.length - 1
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Next step"
        >
          ⏩
        </button>

        {/* Skip to End */}
        <button
          type="button"
          onClick={onSkipToEnd}
          disabled={selectedStepIndex === steps.length - 1}
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded transition-colors",
            selectedStepIndex === steps.length - 1
              ? "text-muted-foreground/30 cursor-not-allowed"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          )}
          title="Skip to end"
        >
          ⏭
        </button>
      </div>

      {/* Step Counter */}
      <div className="text-center mt-2 text-xs text-muted-foreground">
        {selectedStepIndex + 1} / {steps.length} steps
      </div>
    </div>
  );
}
