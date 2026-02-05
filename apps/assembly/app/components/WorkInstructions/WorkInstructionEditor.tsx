import { useCallback, useState } from "react";
import {
  useAnimationPlayback,
  useXeokit,
  XeokitCanvas
} from "~/components/Viewer";
import type {
  AssemblyProject,
  AssemblyStep,
  AssemblyTreeNode,
  StandardNote,
  Tool
} from "~/types/assembly.types";
import { PlaybackControls } from "./CenterViewer/PlaybackControls";
import { StepNavigation } from "./CenterViewer/StepNavigation";
import { ViewerToolbar } from "./CenterViewer/ViewerToolbar";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";

export interface WorkInstructionEditorProps {
  project: AssemblyProject;
  steps: AssemblyStep[];
  tools: Tool[];
  standardNotes: StandardNote[];
  assemblyTree: AssemblyTreeNode;
  modelUrl?: string;
  onStepUpdate?: (stepId: string, updates: Partial<AssemblyStep>) => void;
  onStepsReorder?: (fromIndex: number, toIndex: number) => void;
  onSave?: () => Promise<void>;
}

export function WorkInstructionEditor({
  project,
  steps,
  tools,
  standardNotes,
  assemblyTree,
  modelUrl,
  onStepUpdate,
  onStepsReorder,
  onSave
}: WorkInstructionEditorProps) {
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [leftPanelTab, setLeftPanelTab] = useState<"model" | "instructions">(
    "instructions"
  );
  const [rightPanelTab, setRightPanelTab] = useState<
    "supplements" | "tools" | "notes" | "standardNotes" | "media"
  >("supplements");

  const {
    viewer,
    viewerState,
    handleViewerReady,
    handlePartSelected,
    setView,
    fitToView,
    setExplodedView,
    goToStep
  } = useXeokit({
    onPartSelected: (partId, partName) => {
      console.log("Part selected:", partId, partName);
    }
  });

  // Animation playback engine
  const {
    isPlaying,
    hiddenPartIds: animationHiddenIds,
    play: animPlay,
    pause: animPause
  } = useAnimationPlayback({
    viewer,
    steps,
    selectedStepIndex,
    onStepChange: (index) => {
      setSelectedStepIndex(index);
    }
  });

  const currentStep = steps[selectedStepIndex];

  // Handle step selection
  const handleStepSelect = useCallback(
    (index: number) => {
      setSelectedStepIndex(index);
      const step = steps[index];
      if (step) {
        goToStep(step.id, step.partIds, step.cameraPreset);
      }
    },
    [steps, goToStep]
  );

  // Handle playback
  const handlePlay = useCallback(() => {
    animPlay();
  }, [animPlay]);

  const handlePause = useCallback(() => {
    animPause();
  }, [animPause]);

  const handleNext = useCallback(() => {
    if (selectedStepIndex < steps.length - 1) {
      handleStepSelect(selectedStepIndex + 1);
    }
  }, [selectedStepIndex, steps.length, handleStepSelect]);

  const handlePrevious = useCallback(() => {
    if (selectedStepIndex > 0) {
      handleStepSelect(selectedStepIndex - 1);
    }
  }, [selectedStepIndex, handleStepSelect]);

  const handleSkipToStart = useCallback(() => {
    handleStepSelect(0);
  }, [handleStepSelect]);

  const handleSkipToEnd = useCallback(() => {
    handleStepSelect(steps.length - 1);
  }, [steps.length, handleStepSelect]);

  // Handle step update
  const handleStepFieldUpdate = useCallback(
    (field: keyof AssemblyStep, value: unknown) => {
      if (currentStep && onStepUpdate) {
        onStepUpdate(currentStep.id, {
          [field]: value
        } as Partial<AssemblyStep>);
      }
    },
    [currentStep, onStepUpdate]
  );

  return (
    <div className="flex h-full w-full bg-background">
      {/* Left Panel - Steps / Model Tree */}
      <LeftPanel
        steps={steps}
        assemblyTree={assemblyTree}
        selectedStepIndex={selectedStepIndex}
        onStepSelect={handleStepSelect}
        activeTab={leftPanelTab}
        onTabChange={setLeftPanelTab}
        onStepsReorder={onStepsReorder}
      />

      {/* Center Panel - 3D Viewer */}
      <div className="flex-1 flex flex-col bg-[#1a1a2e] relative">
        {/* Viewer Toolbar */}
        <ViewerToolbar
          onFitToView={fitToView}
          onSetView={setView}
          onToggleExploded={() => setExplodedView(!viewerState.explodedView)}
          isExploded={viewerState.explodedView}
        />

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <XeokitCanvas
            modelUrl={modelUrl}
            modelFormat="gltf"
            onViewerReady={handleViewerReady}
            onPartSelected={handlePartSelected}
            highlightedPartIds={viewerState.highlightedPartIds}
            hiddenPartIds={[
              ...viewerState.hiddenPartIds,
              ...animationHiddenIds
            ]}
          />
        </div>

        {/* Step Navigation Bar */}
        <StepNavigation
          currentStep={currentStep}
          stepIndex={selectedStepIndex}
          totalSteps={steps.length}
          onPrevious={handlePrevious}
          onNext={handleNext}
        />

        {/* Playback Controls */}
        <PlaybackControls
          steps={steps}
          selectedStepIndex={selectedStepIndex}
          isPlaying={isPlaying}
          onPlay={handlePlay}
          onPause={handlePause}
          onSkipToStart={handleSkipToStart}
          onSkipToEnd={handleSkipToEnd}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onStepSelect={handleStepSelect}
        />
      </div>

      {/* Right Panel - Step Details */}
      <RightPanel
        step={currentStep}
        tools={tools}
        standardNotes={standardNotes}
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        onStepUpdate={handleStepFieldUpdate}
      />
    </div>
  );
}
