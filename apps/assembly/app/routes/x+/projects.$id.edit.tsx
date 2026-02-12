import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { assemblySimulateTask } from "@carbon/jobs/trigger/assembly-simulate";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input
} from "@carbon/react";
import { tasks } from "@trigger.dev/sdk";
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
import { ExportModal } from "~/components/WorkInstructions/ExportModal";
import { SettingsDrawer } from "~/components/WorkInstructions/SettingsDrawer";
import type {
  AssemblyStep,
  AssemblyTreeNode,
  CameraState,
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

interface StoredStepKeyframeLike {
  partId: string;
  timestamp: number;
  position: Position3D;
  rotation: Position3D;
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

/** Convert nested/flat matrix to flat column-major 16-element array. */
function toFlatMatrix(transform: number[][] | number[]): number[] {
  if (Array.isArray(transform[0])) {
    const cols = transform as number[][];
    return [
      cols[0][0],
      cols[0][1],
      cols[0][2],
      cols[0][3],
      cols[1][0],
      cols[1][1],
      cols[1][2],
      cols[1][3],
      cols[2][0],
      cols[2][1],
      cols[2][2],
      cols[2][3],
      cols[3][0],
      cols[3][1],
      cols[3][2],
      cols[3][3]
    ];
  }
  return transform as number[];
}

/** Extract Euler rotation in degrees from a column-major 4x4 matrix. */
function extractEulerDegrees(transform: number[][] | number[]): Position3D {
  const m = toFlatMatrix(transform);
  if (m.length < 16) {
    return { x: 0, y: 0, z: 0 };
  }

  // Convert column-major to row-major 3x3 entries.
  const m00 = m[0];
  const m10 = m[1];
  const m11 = m[5];
  const m12 = m[9];
  const m20 = m[2];
  const m21 = m[6];
  const m22 = m[10];

  const sy = Math.sqrt(m00 * m00 + m10 * m10);
  const singular = sy < 1e-6;

  let x = 0;
  let y = 0;
  let z = 0;

  if (!singular) {
    x = Math.atan2(m21, m22);
    y = Math.atan2(-m20, sy);
    z = Math.atan2(m10, m00);
  } else {
    x = Math.atan2(-m12, m11);
    y = Math.atan2(-m20, sy);
    z = 0;
  }

  const toDeg = (v: number) => (v * 180) / Math.PI;
  return { x: toDeg(x), y: toDeg(y), z: toDeg(z) };
}

function isStoredStepKeyframe(value: unknown): value is StoredStepKeyframeLike {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.partId === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.position === "object" &&
    typeof record.rotation === "object"
  );
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
  raw: RustAnimationKeyframe[] | StepKeyframe[],
  partId: string
): StepKeyframe[] {
  if (!raw || raw.length === 0) return [];

  // Preserve frontend-authored keyframes as-is.
  if (isStoredStepKeyframe(raw[0])) {
    return (raw as StepKeyframe[])
      .filter((kf) => kf.partId === partId || !partId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  const rustKeyframes = raw as RustAnimationKeyframe[];
  if (rustKeyframes.length < 2) return [];

  // The last keyframe (time ≈ 1.0) is the rest/assembled position
  const restT = extractTranslation(
    rustKeyframes[rustKeyframes.length - 1].transform
  );

  return rustKeyframes
    .map((kf) => {
      const t = extractTranslation(kf.transform);
      return {
        partId,
        timestamp: kf.time,
        position: {
          x: t[0] - restT[0],
          y: t[1] - restT[1],
          z: t[2] - restT[2]
        } as Position3D,
        rotation: extractEulerDegrees(kf.transform)
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
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

  // Convert database steps to typed steps
  const steps: AssemblyStep[] = dbSteps?.length
    ? dbSteps.map((s) => {
        // Cast Json[] to string[] early to fix type issues
        const partIds = (Array.isArray(s.partIds) ? s.partIds : []) as string[];
        const partNames = (
          Array.isArray(s.partNames) ? s.partNames : []
        ) as string[];
        return {
          id: s.id,
          projectId: s.projectId,
          stepNumber: String(s.stepNumber),
          parentStepId: s.groupId ?? undefined,
          partIds,
          partNames,
          animationData: s.animationPath
            ? {
                keyframes:
                  partIds.length > 0
                    ? partIds.flatMap((partId) =>
                        convertAnimationPath(
                          s.animationPath as unknown as RustAnimationKeyframe[],
                          partId
                        )
                      )
                    : convertAnimationPath(
                        s.animationPath as unknown as RustAnimationKeyframe[],
                        ""
                      )
              }
            : undefined,
          duration: s.duration ?? 1000,
          cameraPreset: (s.cameraPosition as CameraState | null) ?? undefined,
          title: s.title ?? "",
          instruction: s.instruction ?? "",
          notes: s.notes ?? undefined,
          tools: Array.isArray(s.toolIds)
            ? (s.toolIds as string[]).map((toolId) => {
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
            ? (s.warnings as string[]).map((w) => ({
                type: "caution" as const,
                message: w
              }))
            : [],
          groupId: s.groupId ?? undefined,
          groupLabel: undefined
        };
      })
    : [];

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
    })) ?? [];

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
    })) ?? [];

  // Get assembly tree from project or use mock
  const assemblyTree: AssemblyTreeNode =
    project.assemblyTree ?? emptyAssemblyTree;

  // Get model URL if available (from CAD parsing)
  const modelUrl = project.modelPath
    ? `/file/model/${project.modelPath}`
    : undefined;

  // Get share links
  const { data: shareLinks } = await client
    .from("assemblyShareLink")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false });

  return {
    project,
    steps,
    tools,
    standardNotes,
    assemblyTree,
    modelUrl,
    shareLinks: shareLinks ?? []
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

  // Handle share link creation
  if (intent === "createShareLink") {
    const allowDownload = formData.get("allowDownload") === "true";
    const expiresInDays = Number.parseInt(
      formData.get("expiresInDays") as string,
      10
    );
    const password = formData.get("password") as string;

    const token = crypto.randomUUID();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await client.from("assemblyShareLink").insert({
      projectId,
      token,
      expiresAt,
      password: password || null,
      allowDownload,
      createdBy: userId
    });

    return { ok: true };
  }

  // Handle video export
  if (intent === "exportVideo") {
    // TODO: Trigger video export job via Trigger.dev
    return { ok: true, message: "Video export started" };
  }

  // Handle PDF export
  if (intent === "exportPdf") {
    // TODO: Generate PDF
    return { ok: true, message: "PDF export started" };
  }

  // Handle re-run simulation
  if (intent === "resimulate") {
    await client
      .from("assemblyProject")
      .update({
        status: "simulating",
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", projectId)
      .eq("companyId", companyId);

    await tasks.trigger<typeof assemblySimulateTask>("assembly-simulate", {
      projectId,
      companyId
    });

    return redirect(
      path.to.projectEdit(projectId),
      await flash(request, success("Simulation started"))
    );
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

const emptyAssemblyTree: AssemblyTreeNode = {
  id: "root",
  name: "Assembly",
  originalName: "Assembly",
  type: "assembly",
  children: []
};

export default function ProjectEditRoute() {
  const {
    project,
    steps: initialSteps,
    tools,
    standardNotes,
    assemblyTree,
    modelUrl,
    shareLinks
  } = useLoaderData<typeof loader>();

  const [steps, setSteps] = useState<AssemblyStep[]>(initialSteps);
  const [editingName, setEditingName] = useState(false);
  const [projectName, setProjectName] = useState(project.name);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();
  const nameFetcher = useFetcher();
  const resimFetcher = useFetcher();
  const isSaving = fetcher.state === "submitting";
  const isResimulating = resimFetcher.state === "submitting";

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

  const handleResimulate = useCallback(() => {
    resimFetcher.submit({ intent: "resimulate" }, { method: "post" });
  }, [resimFetcher]);

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
              <DropdownMenuItem onSelect={() => setShowExportModal(true)}>
                <BsDownload className="w-4 h-4 mr-2" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowSettings(true)}>
                <BsGear className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleResimulate}
                disabled={isResimulating || project.status === "simulating"}
              >
                <BsPlayCircle className="w-4 h-4 mr-2" />
                {isResimulating ? "Starting..." : "Re-run Simulation"}
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

      {/* Simulation status banner */}
      {steps.length === 0 && (
        <div className="border-b bg-muted/50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {project.status === "simulating"
              ? "Simulation is running... This may take a few minutes."
              : project.status === "failed"
                ? "Simulation failed. You can retry by re-running the simulation."
                : "No assembly steps yet. Run a simulation to generate work instructions."}
          </p>
          {project.status !== "simulating" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResimulate}
              disabled={isResimulating}
            >
              <BsPlayCircle className="w-4 h-4 mr-2" />
              {isResimulating ? "Starting..." : "Re-run Simulation"}
            </Button>
          )}
        </div>
      )}

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

      <ExportModal
        open={showExportModal}
        onOpenChange={setShowExportModal}
        projectId={project.id}
        shareLinks={shareLinks}
      />

      <SettingsDrawer open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
