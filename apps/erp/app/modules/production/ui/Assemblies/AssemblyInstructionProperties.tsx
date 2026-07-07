import { useCarbon } from "@carbon/auth";
import {
  Array as ArrayInput,
  Boolean as BooleanInput,
  Hidden,
  Input,
  Number,
  SelectControlled,
  Submit,
  ValidatedForm
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  HStack,
  Input as InputBase,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type { AssemblyGraphIndex } from "@carbon/viewer";
import { describeStep, stepTimelineSeconds } from "@carbon/viewer";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { useFetcher, useParams } from "react-router";
import { Empty } from "~/components";
import { UnitOfMeasure } from "~/components/Form";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";
import { procedureStepType } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import {
  assemblyInstructionStepValidator,
  fastenerSchema,
  motionSchema,
  stepPlanWarningsSchema
} from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import type {
  AssemblyInstructionStepRow,
  AssemblyStandardNote,
  AssemblyStepMaterial,
  AssemblyStepRequirement
} from "../../types";
import AssemblyStepBom from "./AssemblyStepBom";
import AssemblyStepMaterials from "./AssemblyStepMaterials";
import AssemblyStepRequirements from "./AssemblyStepRequirements";

type AssemblyInstructionPropertiesProps = {
  step: AssemblyInstructionStepRow | null;
  draftPartNodeIds: string[] | null;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  requirements: AssemblyStepRequirement[];
  stepMaterials: AssemblyStepMaterial[];
  bomMaterials: FlattenedBomMaterial[];
  standardNotes: AssemblyStandardNote[];
  /** The active step's motion path is open in the 3D editor */
  isEditingMotion: boolean;
  onEditMotion: (stepId: string) => void;
  onStopEditMotion: () => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
};

const AssemblyInstructionProperties = ({
  step,
  draftPartNodeIds,
  isDisabled,
  graphIndex,
  requirements,
  stepMaterials,
  bomMaterials,
  standardNotes,
  isEditingMotion,
  onEditMotion,
  onStopEditMotion,
  onSetCamera,
  onClearCamera
}: AssemblyInstructionPropertiesProps) => {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          Step
        </h3>
      </VStack>
      {step ? (
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger className="flex-1" value="details">
              Details
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="bom">
              BOM
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="requirements">
              Requirements
            </TabsTrigger>
          </TabsList>
          {/* forceMount keeps unsaved form edits alive while the BOM tab is open */}
          <TabsContent
            value="details"
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <StepForm
              key={step.id}
              step={step}
              draftPartNodeIds={draftPartNodeIds}
              isDisabled={isDisabled}
              graphIndex={graphIndex}
              isEditingMotion={isEditingMotion}
              onEditMotion={onEditMotion}
              onStopEditMotion={onStopEditMotion}
              onSetCamera={onSetCamera}
              onClearCamera={onClearCamera}
            />
          </TabsContent>
          <TabsContent value="bom">
            <VStack spacing={4} className="w-full py-2">
              <AssemblyStepMaterials
                stepId={step.id}
                instructionId={instructionId}
                materials={stepMaterials}
                bomMaterials={bomMaterials}
                isDisabled={isDisabled}
              />
              <AssemblyStepBom
                partNodeIds={draftPartNodeIds ?? step.partNodeIds ?? []}
                hasUnsavedParts={
                  draftPartNodeIds !== null &&
                  JSON.stringify(draftPartNodeIds) !==
                    JSON.stringify(step.partNodeIds ?? [])
                }
                graphIndex={graphIndex}
              />
            </VStack>
          </TabsContent>
          <TabsContent value="requirements">
            <AssemblyStepRequirements
              stepId={step.id}
              instructionId={instructionId}
              requirements={requirements}
              standardNotes={standardNotes}
              isDisabled={isDisabled}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <Empty className="border-none">Select a step to edit it</Empty>
      )}
    </VStack>
  );
};

export default AssemblyInstructionProperties;

type FastenerDraft = {
  spec: string;
  count: string;
  torqueNm: string;
  tool: string;
};

function makeFastenerDraft(fastener: unknown): FastenerDraft {
  const parsed = fastenerSchema.safeParse(fastener);
  if (!parsed.success) {
    return { spec: "", count: "", torqueNm: "", tool: "" };
  }
  return {
    spec: parsed.data.spec ?? "",
    count: parsed.data.count !== undefined ? String(parsed.data.count) : "",
    torqueNm:
      parsed.data.torqueNm !== undefined ? String(parsed.data.torqueNm) : "",
    tool: parsed.data.tool ?? ""
  };
}

function serializeFastener(draft: FastenerDraft): unknown {
  const fastener: Record<string, unknown> = {};
  if (draft.spec.trim()) fastener.spec = draft.spec.trim();
  if (draft.count.trim()) fastener.count = globalThis.Number(draft.count);
  if (draft.torqueNm.trim())
    fastener.torqueNm = globalThis.Number(draft.torqueNm);
  if (draft.tool.trim()) fastener.tool = draft.tool.trim();
  return Object.keys(fastener).length > 0 ? fastener : null;
}

function StepForm({
  step,
  draftPartNodeIds,
  isDisabled,
  graphIndex,
  isEditingMotion,
  onEditMotion,
  onStopEditMotion,
  onSetCamera,
  onClearCamera
}: {
  step: AssemblyInstructionStepRow;
  draftPartNodeIds: string[] | null;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  isEditingMotion: boolean;
  onEditMotion: (stepId: string) => void;
  onStopEditMotion: () => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
}) {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const [stepType, setStepType] = useState<(typeof procedureStepType)[number]>(
    step.type ?? "Task"
  );
  const [description, setDescription] = useState<JSONContent>(
    (step.description as JSONContent) ?? {}
  );

  const typeOptions = useMemo(
    () =>
      procedureStepType.map((type) => ({
        label: (
          <HStack>
            <ProcedureStepTypeIcon type={type} className="mr-2" />
            {type}
          </HStack>
        ),
        value: type
      })),
    []
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/assembly/${instructionId}/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const [fastener, setFastener] = useState<FastenerDraft>(() =>
    makeFastenerDraft(step.fastener)
  );

  const partNodeIds = draftPartNodeIds ?? step.partNodeIds ?? [];
  const hasUnsavedParts =
    draftPartNodeIds !== null &&
    JSON.stringify(draftPartNodeIds) !== JSON.stringify(step.partNodeIds ?? []);

  const serializedFastener = useMemo(
    () => serializeFastener(fastener),
    [fastener]
  );
  const fastenerValidation = useMemo(
    () => fastenerSchema.nullable().safeParse(serializedFastener),
    [serializedFastener]
  );

  const cannotSave =
    isDisabled ||
    !permissions.can("update", "production") ||
    !fastenerValidation.success;

  // Motion is authored in the 3D viewer now; parse the saved value read-only
  // for the timeline-length hint.
  const savedMotion = useMemo(() => {
    const parsed = motionSchema.safeParse(step.motion);
    return parsed.success ? parsed.data : { type: "none" as const };
  }, [step.motion]);

  const hasCamera = step.camera != null;

  // Title shown when the title field is left blank (derived from parts)
  const derivedTitle = useMemo(
    () =>
      describeStep(
        {
          title: null,
          partNodeIds,
          fastener: fastenerValidation.success ? fastenerValidation.data : null
        },
        graphIndex
      ),
    [partNodeIds, fastenerValidation, graphIndex]
  );

  // Planner flag: no collision-free path exists for these parts. The player
  // fades them in at the seated pose; a manual motion overrides the flag.
  const planFlag = useMemo(() => {
    const parsed = stepPlanWarningsSchema.safeParse(step.warnings);
    if (!parsed.success || parsed.data.flagged !== true) return null;
    const blockers = (parsed.data.blockedBy ?? [])
      .map((nodeId) => graphIndex?.nodesById.get(nodeId)?.name)
      .filter((name): name is string => Boolean(name));
    return { blockers: [...new Set(blockers)] };
  }, [step.warnings, graphIndex]);

  return (
    <ValidatedForm
      validator={assemblyInstructionStepValidator}
      method="post"
      action={path.to.assemblyInstructionStep(instructionId, step.id)}
      defaultValues={{
        id: step.id,
        assemblyInstructionId: instructionId,
        title: step.title ?? "",
        type: step.type ?? "Task",
        required: step.required ?? false,
        unitOfMeasureCode: step.unitOfMeasureCode ?? "",
        minValue: step.minValue ?? undefined,
        maxValue: step.maxValue ?? undefined,
        listValues: step.listValues ?? [],
        durationSeconds: step.durationSeconds ?? undefined
      }}
      fetcher={fetcher}
      className="w-full"
    >
      <Hidden name="id" />
      <Hidden name="assemblyInstructionId" />
      <Hidden name="description" value={JSON.stringify(description)} />
      <Hidden name="partNodeIds" value={JSON.stringify(partNodeIds)} />
      <Hidden name="fastener" value={JSON.stringify(serializedFastener)} />
      <VStack spacing={4} className="w-full pb-4">
        <SelectControlled
          name="type"
          label="Type"
          options={typeOptions}
          value={stepType}
          isReadOnly={isDisabled}
          onChange={(option) => {
            if (option) {
              setStepType(option.value as (typeof procedureStepType)[number]);
            }
          }}
        />
        <Input
          name="title"
          label="Title"
          placeholder={derivedTitle ?? "Untitled step"}
        />
        <VStack spacing={2} className="w-full">
          <Label>Instruction</Label>
          <Editor
            initialValue={(step.description as JSONContent) ?? {}}
            onUpload={onUploadImage}
            onChange={(value) => {
              setDescription(value);
            }}
            className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
          />
        </VStack>

        {stepType === "Measurement" && (
          <VStack spacing={2} className="w-full">
            <UnitOfMeasure name="unitOfMeasureCode" label="Unit of Measure" />
            <div className="grid grid-cols-2 gap-2 w-full">
              <Number
                name="minValue"
                label="Minimum"
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
              <Number
                name="maxValue"
                label="Maximum"
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
            </div>
          </VStack>
        )}
        {stepType === "List" && (
          <ArrayInput name="listValues" label="List Options" />
        )}
        <BooleanInput
          name="required"
          label="Required"
          description="Operators must record this step to complete the operation"
        />

        <VStack spacing={2} className="w-full">
          <Label>Parts</Label>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {partNodeIds.length} selected
            </Badge>
            {hasUnsavedParts && <Badge variant="outline">Unsaved</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Click parts in the viewer to assign them to this step. Hold shift to
            select multiple parts.
          </p>
        </VStack>

        <VStack spacing={2} className="w-full">
          <HStack className="w-full justify-between">
            <Label>Motion</Label>
            {!isDisabled && (
              <Button
                variant={isEditingMotion ? "primary" : "secondary"}
                size="sm"
                isDisabled={partNodeIds.length === 0}
                onClick={() =>
                  isEditingMotion ? onStopEditMotion() : onEditMotion(step.id)
                }
              >
                {isEditingMotion ? "Done editing path" : "Edit path"}
              </Button>
            )}
          </HStack>
          {partNodeIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Assign parts to this step to edit its motion path.
            </p>
          ) : isEditingMotion ? (
            <p className="text-xs text-muted-foreground">
              Drag the red waypoints in the viewer to shape the insertion path.
              Double-click the path to add a waypoint; select one and press
              Delete to remove it.
            </p>
          ) : planFlag ? (
            <p className="text-xs text-muted-foreground">
              No collision-free insertion path was found
              {planFlag.blockers.length > 0
                ? ` — blocked by ${planFlag.blockers.join(", ")}`
                : ""}
              . Edit the path to author one.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Edit the path to adjust how these parts move into place.
            </p>
          )}
        </VStack>

        <VStack spacing={2} className="w-full">
          <Label>Camera</Label>
          <p className="text-xs text-muted-foreground">
            {hasCamera
              ? "A saved view frames this step during playback."
              : "This step auto-frames during playback. Orbit to the angle you want, then save it."}
          </p>
          {!isDisabled && (
            <HStack spacing={2}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSetCamera(step.id)}
              >
                Set camera to current view
              </Button>
              {hasCamera && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onClearCamera(step.id)}
                >
                  Clear view
                </Button>
              )}
            </HStack>
          )}
        </VStack>

        <VStack spacing={2} className="w-full">
          <Label>Fastener</Label>
          <div className="grid grid-cols-2 gap-2 w-full">
            <FieldInput
              label="Spec"
              placeholder="M5 SHCS"
              value={fastener.spec}
              isDisabled={isDisabled}
              onChange={(spec) =>
                setFastener((previous) => ({ ...previous, spec }))
              }
            />
            <FieldInput
              label="Count"
              type="number"
              placeholder="4"
              value={fastener.count}
              isDisabled={isDisabled}
              onChange={(count) =>
                setFastener((previous) => ({ ...previous, count }))
              }
            />
            <FieldInput
              label="Torque (N·m)"
              type="number"
              placeholder="8"
              value={fastener.torqueNm}
              isDisabled={isDisabled}
              onChange={(torqueNm) =>
                setFastener((previous) => ({ ...previous, torqueNm }))
              }
            />
            <FieldInput
              label="Tool"
              placeholder="4mm hex"
              value={fastener.tool}
              isDisabled={isDisabled}
              onChange={(tool) =>
                setFastener((previous) => ({ ...previous, tool }))
              }
            />
          </div>
          {!fastenerValidation.success && (
            <p className="text-xs text-destructive">
              Fastener is invalid — count must be a whole number and torque must
              be positive
            </p>
          )}
        </VStack>

        <VStack spacing={1} className="w-full">
          <Number
            name="durationSeconds"
            label="Duration (seconds)"
            minValue={0}
          />
          <p className="text-xs text-muted-foreground">
            Timeline length:{" "}
            {stepTimelineSeconds({
              motion: savedMotion,
              durationSeconds: step.durationSeconds
            }).toFixed(1)}
            s{" "}
            {step.durationSeconds
              ? "(explicit override)"
              : "(auto from motion — set a duration to override)"}
          </p>
        </VStack>

        <Submit
          isDisabled={cannotSave || fetcher.state !== "idle"}
          isLoading={fetcher.state !== "idle"}
        >
          Save Step
        </Submit>
      </VStack>
    </ValidatedForm>
  );
}

function FieldInput({
  label,
  value,
  isDisabled,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <InputBase
        aria-label={label}
        type={type}
        step={type === "number" ? "any" : undefined}
        placeholder={placeholder}
        value={value}
        isDisabled={isDisabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </VStack>
  );
}
