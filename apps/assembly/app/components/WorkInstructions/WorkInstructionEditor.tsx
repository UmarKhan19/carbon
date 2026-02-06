import { useCallback, useEffect, useState } from "react";
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
import { FloatingLeftSidebar } from "./FloatingLeftSidebar";
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<
    "supplements" | "tools" | "notes" | "standardNotes" | "media"
  >("supplements");

  const {
    viewer,
    viewerState,
    isModelLoaded,
    handleViewerReady,
    handleModelLoaded,
    handlePartSelected,
    setView,
    fitToView,
    setExplodedView,
    goToStep,
    highlightParts,
    flyToObject
  } = useXeokit({
    onPartSelected: (partId, _partName) => {
      console.log("Part selected in viewer:", partId);
      // When user clicks in 3D viewer, update selection AND highlight the part
      setSelectedNodeId(partId);
      // Note: highlightParts will be called via useEffect below when selectedNodeId changes
    }
  });

  // Sync highlighting when selectedNodeId changes (from either tree click or viewer click)
  useEffect(() => {
    if (selectedNodeId && isModelLoaded) {
      highlightParts([selectedNodeId]);
    } else if (!selectedNodeId && isModelLoaded) {
      highlightParts([]);
    }
  }, [selectedNodeId, isModelLoaded, highlightParts]);

  // Animation playback engine
  const {
    isPlaying,
    hiddenPartIds: animationHiddenIds,
    play: animPlay,
    pause: animPause
  } = useAnimationPlayback({
    viewer,
    isModelLoaded,
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

  // Handle tree node selection (parts highlighting + fly to)
  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      // highlightParts is called automatically via useEffect when selectedNodeId changes
      flyToObject(nodeId, 0.5);
    },
    [flyToObject]
  );

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
      {/* Center Panel - 3D Viewer (full width, floating sidebar overlays) */}
      <div className="flex-1 flex flex-col bg-[#1a1a2e] relative">
        {/* Floating Left Sidebar — overlays the viewer */}
        <FloatingLeftSidebar
          steps={steps}
          assemblyTree={assemblyTree}
          selectedStepIndex={selectedStepIndex}
          onStepSelect={handleStepSelect}
          onStepsReorder={onStepsReorder}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={selectedNodeId}
        />

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
            onModelLoaded={handleModelLoaded}
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
