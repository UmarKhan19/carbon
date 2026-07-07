import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  ClientOnly,
  Spinner,
  toast,
  useInterval,
  useMode
} from "@carbon/react";
import type {
  AssemblyGraph,
  AssemblyPlayerHandle,
  CameraPose,
  Motion
} from "@carbon/viewer";
import { AssemblyPlayer, indexAssemblyGraph } from "@carbon/viewer";
import { msg } from "@lingui/core/macro";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useParams,
  useRevalidator
} from "react-router";
import { Empty } from "~/components";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions } from "~/hooks";
import {
  assemblyInstructionValidator,
  getAssemblyInstruction,
  getAssemblyInstructionStepMaterials,
  getAssemblyInstructionStepRequirements,
  getAssemblyInstructionSteps,
  getAssemblyPartMappings,
  getAssemblyPlanJson,
  getAssemblyStandardNotes,
  getAssemblyUnits,
  getFlattenedBomMaterials,
  getLatestAssemblyPlanJob,
  toViewerStep,
  upsertAssemblyInstruction
} from "~/modules/production";
import AssemblyInstructionExplorer from "~/modules/production/ui/Assemblies/AssemblyInstructionExplorer";
import AssemblyInstructionHeader from "~/modules/production/ui/Assemblies/AssemblyInstructionHeader";
import AssemblyInstructionProperties from "~/modules/production/ui/Assemblies/AssemblyInstructionProperties";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Assemblies`,
  to: path.to.assemblyInstructions,
  module: "production"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [instruction, steps, standardNotes] = await Promise.all([
    getAssemblyInstruction(client, id),
    getAssemblyInstructionSteps(client, id),
    getAssemblyStandardNotes(client, companyId)
  ]);

  if (instruction.error) {
    throw redirect(
      path.to.assemblyInstructions,
      await flash(
        request,
        error(instruction.error, "Failed to load assembly instruction")
      )
    );
  }

  const stepIds = (steps.data ?? []).map((step) => step.id);
  const [
    requirements,
    stepMaterials,
    plan,
    planJob,
    partMappings,
    units,
    bomMaterials
  ] = await Promise.all([
    getAssemblyInstructionStepRequirements(client, stepIds),
    getAssemblyInstructionStepMaterials(client, stepIds),
    instruction.data.modelUploadId
      ? getAssemblyPlanJson(client, instruction.data.modelUploadId)
      : Promise.resolve(null),
    instruction.data.modelUploadId
      ? getLatestAssemblyPlanJob(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: null }),
    instruction.data.modelUploadId
      ? getAssemblyPartMappings(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: [] }),
    instruction.data.modelUploadId
      ? getAssemblyUnits(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: [] }),
    instruction.data.itemId
      ? getFlattenedBomMaterials(client, instruction.data.itemId, companyId)
      : Promise.resolve([])
  ]);

  return {
    instruction: instruction.data,
    steps: steps.data ?? [],
    requirements: requirements.data ?? [],
    stepMaterials: stepMaterials.data ?? [],
    standardNotes: standardNotes.data ?? [],
    units: units.data ?? [],
    plan,
    planJob: planJob.data ?? null,
    partMappings: partMappings.data ?? [],
    bomMaterials
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(assemblyInstructionValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyInstruction(client, {
    ...validation.data,
    id,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update assembly instruction")
      )
    );
  }

  throw redirect(
    path.to.assemblyInstruction(id),
    await flash(request, success("Updated assembly instruction"))
  );
}

export default function AssemblyInstructionRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const {
    instruction,
    steps,
    requirements,
    stepMaterials,
    standardNotes,
    units,
    plan,
    planJob,
    partMappings,
    bomMaterials
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const mode = useMode();

  const isDisabled =
    instruction.status !== "Draft" || !permissions.can("update", "production");

  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    steps[0]?.id ?? null
  );
  const [draftPartNodeIds, setDraftPartNodeIds] = useState<string[] | null>(
    null
  );
  const [graph, setGraph] = useState<AssemblyGraph | null>(null);
  const graphIndex = useMemo(
    () => (graph ? indexAssemblyGraph(graph) : null),
    [graph]
  );
  // The current part selection — a single source of truth shared by all three
  // panels: it renders red in the viewer, marks + scrolls to the row in the
  // Parts panel, and (while authoring a step) stages the step's draft parts.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  // Add-mode: while on, picking parts (in the viewer or the Parts panel) appends
  // them to the active step. Off by default, so plain selection never mutates a
  // step's parts — you must explicitly start adding.
  const [isAddingParts, setIsAddingParts] = useState(false);

  const selectedStep =
    steps.find((step) => step.id === selectedStepId) ?? steps[0] ?? null;
  const activeStepIndex = selectedStep
    ? steps.findIndex((step) => step.id === selectedStep.id)
    : 0;

  // Read the latest steps inside the stable onSelectStep without widening its
  // deps (it feeds explorer effects that must not re-fire on every steps change).
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Autosave the active step's parts (Add/remove in the Details panel) via a
  // partial-update route, mirroring the motion-path autosave — never touching
  // the title/typed fields.
  const partsFetcher = useFetcher<{ success: boolean }>();
  const savePartNodeIds = useCallback(
    (stepId: string, partNodeIds: string[]) => {
      const formData = new FormData();
      formData.set("partNodeIds", JSON.stringify(partNodeIds));
      partsFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepParts(id, stepId)
      });
    },
    [partsFetcher, id]
  );

  const onSelectStep = useCallback(
    (stepId: string, options?: { selectParts?: boolean }) => {
      setSelectedStepId(stepId);
      setDraftPartNodeIds(null);
      setIsAddingParts(false);
      // Leave any open motion-path edit session when moving to another step.
      setEditingStepId(null);
      setDraftMotion(null);
      // Selecting a step makes its parts the active selection — red in the
      // viewer, marked in the Parts panel. Viewer-driven changes (playback,
      // scrub, on-screen nav) pass selectParts:false so auto-advance doesn't
      // stomp the selection the user is working with.
      if (options?.selectParts !== false) {
        const step = stepsRef.current.find(
          (candidate) => candidate.id === stepId
        );
        if (step) setSelectedNodeIds(step.partNodeIds ?? []);
      }
    },
    []
  );

  // Picking parts (in the viewer or the Parts panel) drives the shared
  // selection. It only touches the active step's parts while add-mode is on —
  // then each selection is appended (union) and autosaved immediately.
  const onSelectParts = useCallback(
    (nodeIds: string[]) => {
      setSelectedNodeIds(nodeIds);
      if (isAddingParts && !isDisabled && selectedStep) {
        const base = draftPartNodeIds ?? selectedStep.partNodeIds ?? [];
        const next = Array.from(new Set([...base, ...nodeIds]));
        setDraftPartNodeIds(next);
        savePartNodeIds(selectedStep.id, next);
      }
    },
    [isAddingParts, isDisabled, selectedStep, draftPartNodeIds, savePartNodeIds]
  );

  // Enter add-mode with a clean slate: clear the selection so the parts picked
  // *next* are the ones added, not whatever happened to be highlighted.
  const onStartAddParts = useCallback(() => {
    setIsAddingParts(true);
    setSelectedNodeIds([]);
  }, []);

  const onStopAddParts = useCallback(() => setIsAddingParts(false), []);

  // Remove a part group from the active step (autosaved), dropping it from the
  // current selection so the viewer highlight stays in sync.
  const onRemoveParts = useCallback(
    (nodeIds: string[]) => {
      if (isDisabled || !selectedStep) return;
      const remove = new Set(nodeIds);
      const base = draftPartNodeIds ?? selectedStep.partNodeIds ?? [];
      const next = base.filter((nodeId) => !remove.has(nodeId));
      setDraftPartNodeIds(next);
      savePartNodeIds(selectedStep.id, next);
      setSelectedNodeIds((prev) =>
        prev.filter((nodeId) => !remove.has(nodeId))
      );
    },
    [isDisabled, selectedStep, draftPartNodeIds, savePartNodeIds]
  );

  const viewerSteps = useMemo(() => steps.map(toViewerStep), [steps]);

  // Authored subassembly units, normalized for step-title derivation: a step
  // whose parts are exactly a unit is titled by the unit's name ("Add Board").
  const namedUnits = useMemo(
    () =>
      units.map((unit) => ({
        name: unit.name,
        partNodeIds: unit.partNodeIds ?? []
      })),
    [units]
  );

  const modelUpload = instruction.modelUpload;
  const glbPath = modelUpload?.glbPath;
  const graphPath = modelUpload?.graphPath;

  // Conversion is lazy (kicked off when the instruction was created), so the
  // artifacts may still be in flight — poll until they land. "Idle" without
  // artifacts covers the window before the queued event is picked up.
  const isConverting =
    !glbPath &&
    (modelUpload?.processingStatus === "Queued" ||
      modelUpload?.processingStatus === "Processing" ||
      modelUpload?.processingStatus === "Idle");
  const revalidator = useRevalidator();
  useInterval(() => revalidator.revalidate(), isConverting ? 5000 : null);
  const retryFetcher = useFetcher<{}>();

  // --- Motion path + camera editing (viewer-driven) ------------------------
  // The 3D viewer edits the active step's motion path (drag waypoints) and
  // captures its camera; both autosave via a dedicated partial-update route so
  // they never round-trip the whole step form. `draftMotion` is the controlled
  // value the viewer renders while editing.
  const playerRef = useRef<AssemblyPlayerHandle>(null);
  const motionFetcher = useFetcher<{ success: boolean }>();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [draftMotion, setDraftMotion] = useState<Motion | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMotion = useCallback(
    (stepId: string, body: { motion?: Motion; camera?: CameraPose | null }) => {
      const formData = new FormData();
      if (body.motion !== undefined) {
        formData.set("motion", JSON.stringify(body.motion));
      }
      if (body.camera !== undefined) {
        formData.set("camera", JSON.stringify(body.camera));
      }
      motionFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepMotion(id, stepId)
      });
    },
    [motionFetcher, id]
  );

  const onEditMotion = useCallback(
    (stepId: string) => {
      const viewerStep = viewerSteps.find((s) => s.id === stepId);
      setSelectedStepId(stepId);
      setEditingStepId(stepId);
      setDraftMotion(viewerStep?.motion ?? { type: "none" });
    },
    [viewerSteps]
  );

  const onStopEditMotion = useCallback(() => {
    setEditingStepId(null);
    setDraftMotion(null);
  }, []);

  const onMotionChange = useCallback(
    (stepId: string, motion: Motion) => {
      setDraftMotion(motion);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveMotion(stepId, { motion }), 400);
    },
    [saveMotion]
  );

  const onSetCamera = useCallback(
    (stepId: string) => {
      const pose = playerRef.current?.captureCameraPose();
      if (!pose) {
        toast.error("The model isn't ready yet");
        return;
      }
      saveMotion(stepId, { camera: pose });
    },
    [saveMotion]
  );

  const onClearCamera = useCallback(
    (stepId: string) => saveMotion(stepId, { camera: null }),
    [saveMotion]
  );

  const isEditingSelectedMotion =
    editingStepId !== null && selectedStep?.id === editingStepId;

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <AssemblyInstructionHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex grow overflow-hidden">
            <ResizablePanels
              explorer={
                <AssemblyInstructionExplorer
                  steps={steps}
                  units={units}
                  selectedStepId={selectedStep?.id ?? null}
                  isDisabled={isDisabled}
                  isConverting={isConverting}
                  graphIndex={graphIndex}
                  hasPlan={Boolean(plan)}
                  planJob={planJob}
                  modelUploadId={instruction.modelUploadId}
                  partMappings={partMappings}
                  bomMaterials={bomMaterials}
                  selectedNodeIds={selectedNodeIds}
                  onSelectStep={onSelectStep}
                  onHighlightParts={onSelectParts}
                  onHideParts={setHiddenNodeIds}
                />
              }
              content={
                <div className="bg-background h-[calc(100dvh-99px)] w-full">
                  {glbPath && graphPath ? (
                    <ClientOnly
                      fallback={
                        <div className="flex h-full w-full items-center justify-center">
                          <Spinner className="h-10 w-10" />
                        </div>
                      }
                    >
                      {() => (
                        <AssemblyPlayer
                          ref={playerRef}
                          glbUrl={getPrivateUrl(glbPath)}
                          graphUrl={getPrivateUrl(graphPath)}
                          steps={viewerSteps}
                          activeStepIndex={Math.max(activeStepIndex, 0)}
                          onStepChange={(index) => {
                            const step = steps[index];
                            if (step)
                              onSelectStep(step.id, { selectParts: false });
                          }}
                          onSelectParts={onSelectParts}
                          onGraphLoaded={setGraph}
                          highlightedNodeIds={selectedNodeIds}
                          hiddenNodeIds={hiddenNodeIds}
                          readOnly={isDisabled}
                          editMotion={
                            editingStepId &&
                            selectedStep?.id === editingStepId &&
                            draftMotion
                              ? { stepId: editingStepId, motion: draftMotion }
                              : null
                          }
                          onMotionChange={onMotionChange}
                          units={namedUnits}
                          autoPlay={false}
                          mode={mode}
                          className="h-full"
                        />
                      )}
                    </ClientOnly>
                  ) : isConverting ? (
                    <div className="flex flex-col h-full w-full items-center justify-center gap-4">
                      <Spinner className="h-10 w-10" />
                      <p className="text-sm text-muted-foreground max-w-[320px] text-center">
                        Converting the model for assembly instructions… this can
                        take a minute.
                      </p>
                    </div>
                  ) : modelUpload?.processingStatus === "Failed" ? (
                    <Empty>
                      <p className="text-sm text-muted-foreground max-w-[320px] text-center">
                        {modelUpload?.processingError ??
                          "Model conversion failed"}
                      </p>
                      <retryFetcher.Form
                        method="post"
                        action={path.to.assemblyModelConvert(id!)}
                      >
                        <Button
                          type="submit"
                          variant="secondary"
                          isLoading={retryFetcher.state !== "idle"}
                          isDisabled={
                            retryFetcher.state !== "idle" ||
                            !permissions.can("update", "production")
                          }
                        >
                          Retry conversion
                        </Button>
                      </retryFetcher.Form>
                    </Empty>
                  ) : (
                    <Empty>
                      <p className="text-sm text-muted-foreground max-w-[320px] text-center">
                        The model has not been processed for assembly
                        instructions yet
                      </p>
                    </Empty>
                  )}
                </div>
              }
              properties={
                <AssemblyInstructionProperties
                  key={selectedStep?.id ?? "empty"}
                  step={selectedStep}
                  draftPartNodeIds={draftPartNodeIds}
                  selectedNodeIds={selectedNodeIds}
                  isAddingParts={isAddingParts}
                  isDisabled={isDisabled}
                  graphIndex={graphIndex}
                  units={namedUnits}
                  onSelectParts={onSelectParts}
                  onStartAddParts={onStartAddParts}
                  onStopAddParts={onStopAddParts}
                  onRemoveParts={onRemoveParts}
                  isEditingMotion={isEditingSelectedMotion}
                  onEditMotion={onEditMotion}
                  onStopEditMotion={onStopEditMotion}
                  onSetCamera={onSetCamera}
                  onClearCamera={onClearCamera}
                  requirements={
                    selectedStep
                      ? requirements.filter(
                          (requirement) =>
                            requirement.stepId === selectedStep.id
                        )
                      : []
                  }
                  stepMaterials={
                    selectedStep
                      ? stepMaterials.filter(
                          (material) => material.stepId === selectedStep.id
                        )
                      : []
                  }
                  bomMaterials={bomMaterials}
                  standardNotes={standardNotes}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
