import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input
} from "@carbon/react";
import { useCallback, useRef, useState } from "react";
import {
  BsArrowLeft,
  BsDownload,
  BsGear,
  BsPlayCircle,
  BsThreeDots,
  BsTrash
} from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { WorkInstructionEditor } from "~/components/WorkInstructions";
import type {
  AssemblyStep,
  AssemblyTreeNode,
  Position3D,
  StandardNote,
  StepKeyframe,
  Tool
} from "~/types/assembly.types";
import { path } from "~/utils/path";

// ---------------------------------------------------------------------------
// Animation data conversion: Rust AnimationKeyframe → frontend StepKeyframe
// ---------------------------------------------------------------------------

interface RustAnimationKeyframe {
  time: number;
  // nalgebra Matrix4 serialises as column-major nested array:
  // [[col0], [col1], [col2], [col3]] – translation is col3[0..2]
  transform: number[][] | number[];
}

/** Extract [tx, ty, tz] from a serialised nalgebra Matrix4. */
function extractTranslation(
  transform: number[][] | number[]
): [number, number, number] {
  if (Array.isArray(transform[0])) {
    // Column-major nested: [[col0], [col1], [col2], [col3]]
    const cols = transform as number[][];
    return [cols[3][0], cols[3][1], cols[3][2]];
  }
  // Flat column-major: 16 elements – translation at indices 12,13,14
  const flat = transform as number[];
  return [flat[12], flat[13], flat[14]];
}

/**
 * Convert Rust simulator AnimationKeyframes to frontend StepKeyframes.
 *
 * The Rust simulator outputs absolute 4×4 transforms. The frontend needs
 * *offsets* relative to the entity's model-space rest position so we can
 * apply them via `entity.offset` in xeokit.
 *
 * Convention after conversion:
 *   position = {x:0, y:0, z:0}  →  part is at its model rest position
 *   position = {x:d, …}         →  part is displaced by d along X
 */
function convertAnimationPath(
  raw: RustAnimationKeyframe[],
  partId: string
): StepKeyframe[] {
  if (!raw || raw.length < 2) return [];

  // The last keyframe (time ≈ 1.0) is the rest/assembled position
  const restT = extractTranslation(raw[raw.length - 1].transform);

  return raw.map((kf) => {
    const t = extractTranslation(kf.transform);
    return {
      partId,
      timestamp: kf.time,
      position: {
        x: t[0] - restT[0],
        y: t[1] - restT[1],
        z: t[2] - restT[2]
      } as Position3D,
      rotation: { x: 0, y: 0, z: 0 } as Position3D
    };
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const { data: project, error: projectError } = await client
    .from("assemblyProject")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();

  if (projectError || !project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Get steps
  const { data: dbSteps } = await client
    .from("assemblyStep")
    .select("*")
    .eq("projectId", projectId)
    .order("stepNumber", { ascending: true });

  // Get tool library
  const { data: dbTools } = await client
    .from("assemblyTool")
    .select("*")
    .eq("companyId", companyId);

  // Get standard notes
  const { data: dbStandardNotes } = await client
    .from("assemblyStandardNote")
    .select("*")
    .eq("companyId", companyId);

  // Convert database steps to typed steps, or use mock data
  const steps: AssemblyStep[] = dbSteps?.length
    ? dbSteps.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        stepNumber: String(s.stepNumber),
        parentStepId: s.groupId ?? undefined,
        partIds: Array.isArray(s.partIds) ? s.partIds : [],
        partNames: Array.isArray(s.partNames) ? s.partNames : [],
        animationData: s.animationPath
          ? {
              keyframes: convertAnimationPath(
                s.animationPath as unknown as RustAnimationKeyframe[],
                Array.isArray(s.partIds) ? String(s.partIds[0]) : ""
              )
            }
          : undefined,
        duration: s.duration ?? 1000,
        cameraPreset: s.cameraPosition ?? undefined,
        title: s.title ?? "",
        instruction: s.instruction ?? "",
        notes: s.notes ?? undefined,
        tools: Array.isArray(s.toolIds)
          ? s.toolIds.map((toolId: string) => {
              const tool = dbTools?.find((t) => t.id === toolId);
              return {
                toolId,
                name: tool?.name ?? toolId,
                category: tool?.category,
                imageUrl: tool?.imageUrl
              };
            })
          : [],
        standardNoteIds: [],
        mediaIds: [],
        warnings: Array.isArray(s.warnings)
          ? s.warnings.map((w: string) => ({
              type: "caution" as const,
              message: w
            }))
          : [],
        groupId: s.groupId ?? undefined,
        groupLabel: undefined
      }))
    : mockSteps;

  // Convert tools
  const tools: Tool[] =
    dbTools?.map((t) => ({
      id: t.id,
      companyId: t.companyId,
      name: t.name,
      description: t.description ?? undefined,
      category: t.category ?? "General",
      partNumber: t.partNumber ?? undefined,
      imageUrl: t.imageUrl ?? undefined,
      specifications: t.specifications ?? undefined
    })) ?? mockTools;

  // Convert standard notes
  const standardNotes: StandardNote[] =
    dbStandardNotes?.map((n) => ({
      id: n.id,
      companyId: n.companyId,
      name: n.name,
      content: n.content,
      category: n.category ?? undefined,
      tags: n.tags ?? undefined,
      usageCount: n.usageCount ?? 0
    })) ?? mockStandardNotes;

  // Get assembly tree from project or use mock
  const assemblyTree: AssemblyTreeNode =
    project.assemblyTree ?? mockAssemblyTree;

  // Get model URL if available (from CAD parsing)
  const modelUrl = project.modelPath
    ? `/file/model/${project.modelPath}`
    : undefined;

  return {
    project,
    steps,
    tools,
    standardNotes,
    assemblyTree,
    modelUrl
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Handle project name update
  if (intent === "updateName") {
    const name = formData.get("name") as string;
    if (name?.trim()) {
      await client
        .from("assemblyProject")
        .update({
          name: name.trim(),
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("companyId", companyId);
    }
    return { ok: true };
  }

  const stepsJson = formData.get("steps") as string;

  try {
    const steps = JSON.parse(stepsJson) as AssemblyStep[];

    // Delete existing steps and replace with new ones
    const { error: deleteError } = await client
      .from("assemblyStep")
      .delete()
      .eq("projectId", projectId)
      .eq("companyId", companyId);

    if (deleteError) {
      return redirect(
        path.to.projectEdit(projectId),
        await flash(request, error(deleteError, "Failed to save steps"))
      );
    }

    // Insert updated steps
    if (steps.length > 0) {
      const stepsToInsert = steps.map((step, index) => ({
        id: step.id,
        projectId,
        companyId,
        stepNumber: index + 1,
        groupId: step.groupId || null,
        partIds: step.partIds,
        partNames: step.partNames,
        animationPath: step.animationData?.keyframes || [],
        duration: step.duration,
        title: step.title,
        instruction: step.instruction,
        notes: step.notes || null,
        warnings: step.warnings.map((w) => w.message),
        annotations: [],
        cameraPosition: step.cameraPreset || null,
        toolIds: step.tools.map((t) => t.toolId),
        torqueSpecIds: []
      }));

      const { error: insertError } = await client
        .from("assemblyStep")
        .insert(stepsToInsert);

      if (insertError) {
        return redirect(
          path.to.projectEdit(projectId),
          await flash(request, error(insertError, "Failed to save steps"))
        );
      }
    }

    // Update project timestamp
    await client
      .from("assemblyProject")
      .update({
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", projectId)
      .eq("companyId", companyId);

    return redirect(
      path.to.projectEdit(projectId),
      await flash(request, success("Changes saved successfully"))
    );
  } catch {
    return redirect(
      path.to.projectEdit(projectId),
      await flash(request, error(null, "Invalid step data"))
    );
  }
}

// Mock data for demo
const mockAssemblyTree: AssemblyTreeNode = {
  id: "root",
  name: "Electric Motor Assembly",
  originalName: "Electric Motor Assembly",
  type: "assembly",
  children: [
    {
      id: "base",
      name: "Base Plate",
      originalName: "BASE_PLATE",
      type: "part",
      meshId: "base-mesh"
    },
    {
      id: "housing",
      name: "Motor Housing",
      originalName: "MOTOR_HOUSING",
      type: "assembly",
      children: [
        { id: "rotor", name: "Rotor", originalName: "ROTOR", type: "part" },
        { id: "stator", name: "Stator", originalName: "STATOR", type: "part" }
      ]
    },
    {
      id: "bracket",
      name: "Mounting Bracket",
      originalName: "MOUNTING_BRACKET",
      type: "part"
    },
    {
      id: "fasteners",
      name: "Fasteners",
      originalName: "FASTENERS",
      type: "assembly",
      children: [
        {
          id: "bolt-1",
          name: "M8 Bolt",
          originalName: "M8_BOLT",
          type: "part",
          quantity: 4
        },
        {
          id: "washer-1",
          name: "M8 Washer",
          originalName: "M8_WASHER",
          type: "part",
          quantity: 4
        },
        {
          id: "nut-1",
          name: "M8 Nut",
          originalName: "M8_NUT",
          type: "part",
          quantity: 4
        }
      ]
    }
  ]
};

const mockSteps: AssemblyStep[] = [
  {
    id: "step-1",
    projectId: "demo",
    stepNumber: "1",
    partIds: ["base"],
    partNames: ["Base Plate"],
    duration: 2000,
    title: "Install Base Plate",
    instruction: "Place the base plate on a clean, flat surface.",
    tools: [],
    standardNoteIds: [],
    mediaIds: [],
    warnings: []
  },
  {
    id: "step-2",
    projectId: "demo",
    stepNumber: "2",
    partIds: ["housing"],
    partNames: ["Motor Housing"],
    duration: 3000,
    title: "Attach Motor Housing",
    instruction:
      "Position the motor housing on the base plate, aligning the mounting holes.",
    tools: [],
    standardNoteIds: [],
    mediaIds: [],
    warnings: []
  },
  {
    id: "step-3",
    projectId: "demo",
    stepNumber: "2.1",
    parentStepId: "step-2",
    partIds: ["rotor"],
    partNames: ["Rotor"],
    duration: 3000,
    title: "Install Rotor",
    instruction:
      "Carefully insert the rotor into the motor housing, ensuring proper alignment.",
    tools: [],
    standardNoteIds: [],
    mediaIds: [],
    warnings: [
      {
        type: "caution",
        message: "Handle with care - sensitive magnetic components"
      }
    ]
  },
  {
    id: "step-4",
    projectId: "demo",
    stepNumber: "2.2",
    parentStepId: "step-2",
    partIds: ["stator"],
    partNames: ["Stator"],
    duration: 3000,
    title: "Install Stator",
    instruction:
      "Install the stator around the rotor. Check for proper clearance.",
    tools: [],
    standardNoteIds: [],
    mediaIds: [],
    warnings: []
  },
  {
    id: "step-5",
    projectId: "demo",
    stepNumber: "3",
    partIds: ["bracket"],
    partNames: ["Mounting Bracket"],
    duration: 2000,
    title: "Attach Mounting Bracket",
    instruction: "Position the mounting bracket over the motor housing.",
    tools: [],
    standardNoteIds: [],
    mediaIds: [],
    warnings: []
  },
  {
    id: "step-6",
    projectId: "demo",
    stepNumber: "4",
    partIds: ["bolt-1", "washer-1", "nut-1"],
    partNames: ["M8 Bolt x4", "M8 Washer x4", "M8 Nut x4"],
    duration: 5000,
    title: "Install Fasteners",
    instruction:
      "Insert M8 bolts through the bracket and base plate. Add washers and tighten nuts.",
    tools: [
      { toolId: "tool-1", name: "13mm Socket Wrench", category: "Wrenches" },
      { toolId: "tool-2", name: "Torque Wrench", category: "Wrenches" }
    ],
    standardNoteIds: ["note-1"],
    mediaIds: [],
    warnings: [{ type: "quality", message: "Torque to 25 Nm" }],
    groupLabel: "Fastener Installation"
  }
];

const mockTools: Tool[] = [
  {
    id: "tool-1",
    companyId: "demo",
    name: "13mm Socket Wrench",
    category: "Wrenches"
  },
  {
    id: "tool-2",
    companyId: "demo",
    name: "Torque Wrench",
    category: "Wrenches"
  },
  {
    id: "tool-3",
    companyId: "demo",
    name: "Phillips Screwdriver #2",
    category: "Screwdrivers"
  },
  {
    id: "tool-4",
    companyId: "demo",
    name: "Flathead Screwdriver",
    category: "Screwdrivers"
  },
  {
    id: "tool-5",
    companyId: "demo",
    name: "Needle Nose Pliers",
    category: "Pliers"
  },
  {
    id: "tool-6",
    companyId: "demo",
    name: "Grease Gun",
    category: "Lubrication"
  }
];

const mockStandardNotes: StandardNote[] = [
  {
    id: "note-1",
    companyId: "demo",
    name: "Torque Specification",
    content:
      "Ensure proper torque is applied using a calibrated torque wrench.",
    category: "Quality",
    usageCount: 15
  },
  {
    id: "note-2",
    companyId: "demo",
    name: "Apply Grease",
    content:
      "Apply a thin layer of lithium grease to the bearing surface before installation.",
    category: "Lubrication",
    usageCount: 8
  },
  {
    id: "note-3",
    companyId: "demo",
    name: "Apply Loctite",
    content:
      "Apply Loctite 242 (blue) to threads before installation to prevent loosening.",
    category: "Adhesives",
    usageCount: 12
  },
  {
    id: "note-4",
    companyId: "demo",
    name: "Safety Glasses Required",
    content: "Wear safety glasses during this operation.",
    category: "Safety",
    usageCount: 25
  }
];

export default function ProjectEditRoute() {
  const {
    project,
    steps: initialSteps,
    tools,
    standardNotes,
    assemblyTree,
    modelUrl
  } = useLoaderData<typeof loader>();

  const [steps, setSteps] = useState<AssemblyStep[]>(initialSteps);
  const [editingName, setEditingName] = useState(false);
  const [projectName, setProjectName] = useState(project.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();
  const nameFetcher = useFetcher();
  const isSaving = fetcher.state === "submitting";

  const handleStepUpdate = useCallback(
    (stepId: string, updates: Partial<AssemblyStep>) => {
      setSteps((prev) =>
        prev.map((step) =>
          step.id === stepId ? { ...step, ...updates } : step
        )
      );
    },
    []
  );

  const handleStepsReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSteps((prev) => {
        const newSteps = [...prev];
        const [removed] = newSteps.splice(fromIndex, 1);
        newSteps.splice(toIndex, 0, removed);
        return newSteps;
      });
    },
    []
  );

  const handleSave = useCallback(() => {
    fetcher.submit({ steps: JSON.stringify(steps) }, { method: "post" });
  }, [fetcher, steps]);

  const handleNameSave = useCallback(() => {
    setEditingName(false);
    if (projectName.trim() && projectName !== project.name) {
      nameFetcher.submit(
        {
          intent: "updateName",
          name: projectName.trim()
        },
        { method: "post" }
      );
    }
  }, [nameFetcher, projectName, project.name]);

  const statusStyles: Record<string, string> = {
    published: "bg-green-100 text-green-700",
    editing: "bg-blue-100 text-blue-700",
    simulating: "bg-violet-100 text-violet-700",
    preprocessing: "bg-yellow-100 text-yellow-700",
    parsing: "bg-yellow-100 text-yellow-700",
    failed: "bg-red-100 text-red-700"
  };

  return (
    <div className="flex flex-col h-[calc(100vh-49px)]">
      {/* Top Bar */}
      <div className="h-12 border-b bg-card flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={path.to.dashboard}>
              <BsArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />

          {/* Editable project name */}
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") {
                  setProjectName(project.name);
                  setEditingName(false);
                }
              }}
              className="h-7 text-sm font-semibold w-64"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingName(true);
                setTimeout(() => nameInputRef.current?.select(), 0);
              }}
              className="text-sm font-semibold hover:text-primary transition-colors truncate max-w-[300px]"
              title="Click to rename"
            >
              {projectName}
            </button>
          )}

          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              statusStyles[project.status] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {project.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <BsThreeDots className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <BsDownload className="w-4 h-4 mr-2" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BsGear className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BsPlayCircle className="w-4 h-4 mr-2" />
                Re-run Simulation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                <BsTrash className="w-4 h-4 mr-2" />
                Delete Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 overflow-hidden">
        <WorkInstructionEditor
          project={project}
          steps={steps}
          tools={tools}
          standardNotes={standardNotes}
          assemblyTree={assemblyTree}
          modelUrl={modelUrl}
          onStepUpdate={handleStepUpdate}
          onStepsReorder={handleStepsReorder}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
