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
  ToggleGroup,
  ToggleGroupItem,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type { AssemblyGraphIndex, AssemblyPlan } from "@carbon/viewer";
import {
  describeStep,
  planMotionForParts,
  stepTimelineSeconds,
  synthesizeFallbackMotion
} from "@carbon/viewer";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
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
  plan: AssemblyPlan | null;
  requirements: AssemblyStepRequirement[];
  stepMaterials: AssemblyStepMaterial[];
  bomMaterials: FlattenedBomMaterial[];
  standardNotes: AssemblyStandardNote[];
};

const AssemblyInstructionProperties = ({
  step,
  draftPartNodeIds,
  isDisabled,
  graphIndex,
  plan,
  requirements,
  stepMaterials,
  bomMaterials,
  standardNotes
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
              plan={plan}
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

const motionTypes = ["none", "linear", "L", "helix"] as const;
type MotionType = (typeof motionTypes)[number];

type Vec3Draft = [string, string, string];

type MotionDraft = {
  type: MotionType;
  direction: Vec3Draft;
  distance: string;
  segments: { direction: Vec3Draft; distance: string }[];
  axis: Vec3Draft;
  origin: Vec3Draft;
  pitch: string;
  turns: string;
  approach: string;
};

const zeroVector: Vec3Draft = ["0", "0", "0"];

function toVec3Draft(vector?: [number, number, number]): Vec3Draft {
  if (!vector) return zeroVector;
  return [String(vector[0]), String(vector[1]), String(vector[2])];
}

function makeMotionDraft(motion: unknown): MotionDraft {
  const draft: MotionDraft = {
    type: "none",
    direction: ["0", "0", "-1"],
    distance: "50",
    segments: [
      { direction: ["1", "0", "0"], distance: "50" },
      { direction: ["0", "0", "-1"], distance: "20" }
    ],
    axis: ["0", "0", "-1"],
    origin: zeroVector,
    pitch: "1",
    turns: "5",
    approach: "10"
  };

  const parsed = motionSchema.safeParse(motion);
  if (!parsed.success) return draft;

  const value = parsed.data;
  switch (value.type) {
    case "linear":
      return {
        ...draft,
        type: "linear",
        direction: toVec3Draft(value.direction),
        distance: String(value.distance)
      };
    case "L":
      return {
        ...draft,
        type: "L",
        segments: value.segments.map((segment) => ({
          direction: toVec3Draft(segment.direction),
          distance: String(segment.distance)
        }))
      };
    case "helix":
      return {
        ...draft,
        type: "helix",
        axis: toVec3Draft(value.axis),
        origin: toVec3Draft(value.origin),
        pitch: String(value.pitch),
        turns: String(value.turns),
        approach: String(value.approach)
      };
    case "path":
      // Path motions are not editable in Phase 0 — leave the saved value alone
      return { ...draft, type: "none" };
    default:
      return draft;
  }
}

function describeMotionDraft(draft: MotionDraft): string {
  switch (draft.type) {
    case "linear":
      return `Linear insertion · ${draft.distance} mm`;
    case "L": {
      const total = draft.segments.reduce(
        (sum, segment) =>
          sum + Math.abs(globalThis.Number(segment.distance) || 0),
        0
      );
      return `${draft.segments.length}-segment insertion · ${total} mm`;
    }
    case "helix":
      return `Threaded insertion (helix) · ${draft.turns} turns`;
    default:
      return "No part movement (process step)";
  }
}

function parseVec3(vector: Vec3Draft): [number, number, number] {
  return [
    globalThis.Number(vector[0]),
    globalThis.Number(vector[1]),
    globalThis.Number(vector[2])
  ];
}

function serializeMotion(draft: MotionDraft): unknown {
  switch (draft.type) {
    case "linear":
      return {
        type: "linear",
        direction: parseVec3(draft.direction),
        distance: globalThis.Number(draft.distance)
      };
    case "L":
      return {
        type: "L",
        segments: draft.segments.map((segment) => ({
          direction: parseVec3(segment.direction),
          distance: globalThis.Number(segment.distance)
        }))
      };
    case "helix":
      return {
        type: "helix",
        axis: parseVec3(draft.axis),
        origin: parseVec3(draft.origin),
        pitch: globalThis.Number(draft.pitch),
        turns: globalThis.Number(draft.turns),
        approach: globalThis.Number(draft.approach)
      };
    default:
      return { type: "none" };
  }
}

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
  plan
}: {
  step: AssemblyInstructionStepRow;
  draftPartNodeIds: string[] | null;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  plan: AssemblyPlan | null;
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

  const [motion, setMotion] = useState<MotionDraft>(() =>
    makeMotionDraft(step.motion)
  );
  const [fastener, setFastener] = useState<FastenerDraft>(() =>
    makeFastenerDraft(step.fastener)
  );
  const [autoPlanned, setAutoPlanned] = useState<"high" | "low" | null>(() =>
    step.planConfidence === "high" || step.planConfidence === "low"
      ? step.planConfidence
      : null
  );
  // Motions come from the planner; hand-editing vectors is the rare escape
  // hatch, so the manual editor stays collapsed by default
  const [showMotionEditor, setShowMotionEditor] = useState(false);

  // When the author assigns parts in the viewer, the motion comes from the
  // geometry planner automatically — the manual editor is an override
  useEffect(() => {
    if (!draftPartNodeIds || draftPartNodeIds.length === 0) return;
    // Parts the planner flagged have no proven collision-free path; their
    // recorded motion (older plans fabricated one) must not be auto-filled
    if (
      draftPartNodeIds.some(
        (nodeId) => (plan?.parts[nodeId]?.blockedBy?.length ?? 0) > 0
      )
    ) {
      return;
    }
    const planned = planMotionForParts(plan, draftPartNodeIds);
    if (planned) {
      setMotion(makeMotionDraft(planned.motion));
      setAutoPlanned(planned.confidence);
      return;
    }
    // The plan has nothing for these parts (old plan.json, or none was ever
    // computed): synthesize an AABB-based motion so the step still animates.
    // Never clobbers a motion the author already set by hand.
    if (!graphIndex || motion.type !== "none") return;
    const fallback = synthesizeFallbackMotion(graphIndex, draftPartNodeIds);
    if (fallback && fallback.type !== "none") {
      setMotion(makeMotionDraft(fallback));
      setAutoPlanned("low");
    }
    // motion.type is deliberately not a dependency: it is read as a guard,
    // and re-running on motion edits would fight the manual editor
  }, [draftPartNodeIds, plan, graphIndex]);

  const partNodeIds = draftPartNodeIds ?? step.partNodeIds ?? [];
  const hasUnsavedParts =
    draftPartNodeIds !== null &&
    JSON.stringify(draftPartNodeIds) !== JSON.stringify(step.partNodeIds ?? []);

  const serializedMotion = useMemo(() => serializeMotion(motion), [motion]);
  const motionValidation = useMemo(
    () => motionSchema.safeParse(serializedMotion),
    [serializedMotion]
  );

  // Surface the manual editor when the current motion is invalid
  useEffect(() => {
    if (!motionValidation.success) setShowMotionEditor(true);
  }, [motionValidation.success]);

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
    !motionValidation.success ||
    !fastenerValidation.success;

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
      <Hidden name="motion" value={JSON.stringify(serializedMotion)} />
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
                variant="ghost"
                size="sm"
                onClick={() => setShowMotionEditor((show) => !show)}
              >
                {showMotionEditor ? "Hide manual editor" : "Edit manually"}
              </Button>
            )}
          </HStack>
          <p className="text-sm text-foreground">
            {describeMotionDraft(motion)}
          </p>
          {planFlag && motion.type === "none" ? (
            <p className="text-xs text-muted-foreground">
              No collision-free insertion path was found
              {planFlag.blockers.length > 0
                ? ` — blocked by ${planFlag.blockers.join(", ")}`
                : ""}
              . The parts fade in at their seated pose; set a manual motion to
              override.
            </p>
          ) : (
            <>
              {autoPlanned === "high" && (
                <p className="text-xs text-muted-foreground">
                  Planned automatically from the model's geometry
                </p>
              )}
              {autoPlanned === "low" && (
                <p className="text-xs text-muted-foreground">
                  Planned automatically (low confidence) — verify the animation
                  and adjust if needed
                </p>
              )}
            </>
          )}
          {showMotionEditor && (
            <ToggleGroup
              type="single"
              value={motion.type}
              onValueChange={(value) => {
                if (value && !isDisabled) {
                  setMotion((previous) => ({
                    ...previous,
                    type: value as MotionType
                  }));
                }
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="none">None</ToggleGroupItem>
              <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
              <ToggleGroupItem value="L">L</ToggleGroupItem>
              <ToggleGroupItem value="helix">Helix</ToggleGroupItem>
            </ToggleGroup>
          )}

          {showMotionEditor && motion.type === "linear" && (
            <>
              <VectorInput
                label="Direction"
                value={motion.direction}
                isDisabled={isDisabled}
                onChange={(direction) =>
                  setMotion((previous) => ({ ...previous, direction }))
                }
              />
              <ScalarInput
                label="Distance (mm)"
                value={motion.distance}
                isDisabled={isDisabled}
                onChange={(distance) =>
                  setMotion((previous) => ({ ...previous, distance }))
                }
              />
            </>
          )}

          {showMotionEditor &&
            motion.type === "L" &&
            motion.segments.map((segment, index) => (
              <VStack
                key={`segment-${index}`}
                spacing={2}
                className="w-full rounded-lg border border-border p-2"
              >
                <Label>Segment {index + 1}</Label>
                <VectorInput
                  label="Direction"
                  value={segment.direction}
                  isDisabled={isDisabled}
                  onChange={(direction) =>
                    setMotion((previous) => ({
                      ...previous,
                      segments: previous.segments.map((s, i) =>
                        i === index ? { ...s, direction } : s
                      )
                    }))
                  }
                />
                <ScalarInput
                  label="Distance (mm)"
                  value={segment.distance}
                  isDisabled={isDisabled}
                  onChange={(distance) =>
                    setMotion((previous) => ({
                      ...previous,
                      segments: previous.segments.map((s, i) =>
                        i === index ? { ...s, distance } : s
                      )
                    }))
                  }
                />
              </VStack>
            ))}

          {showMotionEditor && motion.type === "helix" && (
            <>
              <VectorInput
                label="Axis"
                value={motion.axis}
                isDisabled={isDisabled}
                onChange={(axis) =>
                  setMotion((previous) => ({ ...previous, axis }))
                }
              />
              <VectorInput
                label="Origin"
                value={motion.origin}
                isDisabled={isDisabled}
                onChange={(origin) =>
                  setMotion((previous) => ({ ...previous, origin }))
                }
              />
              <div className="grid grid-cols-3 gap-2 w-full">
                <ScalarInput
                  label="Pitch (mm)"
                  value={motion.pitch}
                  isDisabled={isDisabled}
                  onChange={(pitch) =>
                    setMotion((previous) => ({ ...previous, pitch }))
                  }
                />
                <ScalarInput
                  label="Turns"
                  value={motion.turns}
                  isDisabled={isDisabled}
                  onChange={(turns) =>
                    setMotion((previous) => ({ ...previous, turns }))
                  }
                />
                <ScalarInput
                  label="Approach (mm)"
                  value={motion.approach}
                  isDisabled={isDisabled}
                  onChange={(approach) =>
                    setMotion((previous) => ({ ...previous, approach }))
                  }
                />
              </div>
            </>
          )}

          {!motionValidation.success && (
            <p className="text-xs text-destructive">
              Motion is invalid — distances, pitch and turns must be positive
              numbers
            </p>
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
              motion: motionValidation.success
                ? motionValidation.data
                : { type: "none" },
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

function VectorInput({
  label,
  value,
  isDisabled,
  onChange
}: {
  label: string;
  value: Vec3Draft;
  isDisabled: boolean;
  onChange: (value: Vec3Draft) => void;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2 w-full">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <InputBase
            key={axis}
            aria-label={`${label} ${axis}`}
            type="number"
            step="any"
            placeholder={axis}
            value={value[index]}
            isDisabled={isDisabled}
            onChange={(e) => {
              const next: Vec3Draft = [...value];
              next[index] = e.target.value;
              onChange(next);
            }}
          />
        ))}
      </div>
    </VStack>
  );
}

function ScalarInput({
  label,
  value,
  isDisabled,
  onChange
}: {
  label: string;
  value: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <VStack spacing={1} className="w-full">
      <Label>{label}</Label>
      <InputBase
        aria-label={label}
        type="number"
        step="any"
        value={value}
        isDisabled={isDisabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </VStack>
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
