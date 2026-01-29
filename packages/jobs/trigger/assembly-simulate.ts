import { getCarbonServiceRole } from "@carbon/auth";
import { task, logger, metadata } from "@trigger.dev/sdk";

/**
 * Assembly node from the database
 */
interface AssemblyNode {
  id: string;
  name: string;
  original_name?: string;
  originalName?: string;
  node_type?: "assembly" | "part";
  type?: "assembly" | "part";
  children?: AssemblyNode[];
  transform?: number[];
}

/**
 * Animation keyframe from the simulator
 */
interface AnimationKeyframe {
  time: number;
  transform: number[];
}

/**
 * Assembly step from the simulator
 */
interface SimulatorStep {
  step_number: number;
  part_ids: string[];
  part_names: string[];
  assembly_direction: [number, number, number];
  animation_path: AnimationKeyframe[];
  suggested_duration_ms: number;
}

/**
 * Simulation result from the Rust cad-server
 */
interface SimulationResult {
  steps: SimulatorStep[];
  stuck_parts: string[];
  simulation_time_ms: number;
  success: boolean;
  error?: string;
}

/**
 * Response from Rust cad-server /simulate endpoint
 */
interface SimulateResponse {
  success: boolean;
  result?: SimulationResult;
  error?: string;
}

/**
 * Identity matrix (4x4) in column-major order for glTF/WebGL
 * Used when a node has no transform specified
 */
const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0,  // column 0
  0, 1, 0, 0,  // column 1
  0, 0, 1, 0,  // column 2
  0, 0, 0, 1,  // column 3
];

/**
 * Convert database assembly tree format to simulator format
 */
function normalizeAssemblyTree(node: AssemblyNode): AssemblyNode {
  return {
    id: node.id,
    name: node.name,
    original_name: node.original_name || node.originalName || node.name,
    node_type: node.node_type || node.type || "part",
    children: node.children?.map(normalizeAssemblyTree) || [],
    // Rust deserializer requires transform to be present - use identity matrix if not provided
    transform: node.transform ?? IDENTITY_MATRIX,
  };
}

/**
 * Trigger.dev task to run physics simulation on assembly
 *
 * This task:
 * 1. Fetches the assemblyProject's assemblyTree from database
 * 2. Calls the Rust cad-server /simulate endpoint
 * 3. Creates assemblyStep records from the simulation result
 * 4. Updates the project status to "editing"
 */
export const assemblySimulateTask = task({
  id: "assembly-simulate",
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 120000,
  },
  run: async (payload: {
    projectId: string;
    companyId: string;
  }) => {
    const { projectId, companyId } = payload;

    logger.info("Starting assembly simulation", {
      projectId,
      companyId,
    });

    const client = getCarbonServiceRole();
    const cadServerUrl = process.env.CAD_SERVER_URL || "http://localhost:8080";

    // Update status to simulating
    await metadata.set("status", "loading");
    await metadata.set("progress", 10);

    try {
      // 1. Fetch the assembly project
      const { data: project, error: projectError } = await client
        .from("assemblyProject")
        .select("id, assemblyTree, modelPath, companyId")
        .eq("id", projectId)
        .eq("companyId", companyId)
        .single();

      if (projectError || !project) {
        throw new Error(`Failed to fetch project: ${projectError?.message || "Not found"}`);
      }

      if (!project.assemblyTree) {
        throw new Error("Project has no assembly tree. Please parse a STEP file first.");
      }

      if (!project.modelPath) {
        throw new Error("Project has no model file. Please parse a STEP file first.");
      }

      logger.info("Loaded assembly tree", { projectId, modelPath: project.modelPath });

      await metadata.set("status", "downloading_glb");
      await metadata.set("progress", 20);

      // 2. Download the GLB file from storage (needed for mesh data/collision detection)
      logger.info("Downloading GLB for mesh data", { modelPath: project.modelPath });

      const { data: glbData, error: downloadError } = await client.storage
        .from("private")
        .download(project.modelPath);

      if (downloadError || !glbData) {
        throw new Error(`Failed to download GLB: ${downloadError?.message || "Not found"}`);
      }

      // Convert GLB to base64
      const glbArrayBuffer = await glbData.arrayBuffer();
      const glbBase64 = Buffer.from(glbArrayBuffer).toString("base64");

      logger.info("GLB downloaded and encoded", {
        sizeBytes: glbArrayBuffer.byteLength,
        base64Length: glbBase64.length,
      });

      await metadata.set("status", "simulating");
      await metadata.set("progress", 40);

      await client
        .from("assemblyProject")
        .update({ simulationStatus: "running" })
        .eq("id", projectId);

      // 3. Normalize the tree format and call the simulator with GLB data
      const normalizedTree = normalizeAssemblyTree(project.assemblyTree as AssemblyNode);

      logger.info("Calling Rust simulator", { cadServerUrl });

      const response = await fetch(`${cadServerUrl}/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assembly_tree: normalizedTree,
          glb_base64: glbBase64,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Simulator error (${response.status}): ${errorText}`);
      }

      const result: SimulateResponse = await response.json();

      if (!result.success || !result.result) {
        throw new Error(result.error || "Simulation failed");
      }

      logger.info("Simulation completed", {
        stepCount: result.result.steps.length,
        stuckParts: result.result.stuck_parts.length,
        timeMs: result.result.simulation_time_ms,
      });

      await metadata.set("status", "creating_steps");
      await metadata.set("progress", 70);

      // 4. Delete existing steps for this project
      const { error: deleteError } = await client
        .from("assemblyStep")
        .delete()
        .eq("projectId", projectId);

      if (deleteError) {
        logger.warn("Failed to delete existing steps", { error: deleteError.message });
      }

      // 5. Create assemblyStep records from simulation result
      const stepsToInsert = result.result.steps.map((step) => ({
        projectId,
        companyId,
        stepNumber: step.step_number,
        partIds: step.part_ids,
        partNames: step.part_names,
        animationPath: step.animation_path,
        duration: step.suggested_duration_ms,
        title: step.part_names.length === 1
          ? `Install ${step.part_names[0]}`
          : `Install ${step.part_names.join(", ")}`,
        instruction: "",
        notes: null,
        warnings: [],
        annotations: [],
        cameraPosition: null,
        toolIds: [],
        torqueSpecIds: [],
      }));

      if (stepsToInsert.length > 0) {
        const { error: insertError } = await client
          .from("assemblyStep")
          .insert(stepsToInsert);

        if (insertError) {
          throw new Error(`Failed to create steps: ${insertError.message}`);
        }
      }

      logger.info("Created assembly steps", { count: stepsToInsert.length });

      await metadata.set("status", "finalizing");
      await metadata.set("progress", 90);

      // 6. Update project status
      const { error: updateError } = await client
        .from("assemblyProject")
        .update({
          status: "editing",
          simulationStatus: "completed",
          simulationResult: result.result,
          simulationError: null,
          simulatedAt: new Date().toISOString(),
        })
        .eq("id", projectId);

      if (updateError) {
        throw new Error(`Failed to update project: ${updateError.message}`);
      }

      await metadata.set("status", "completed");
      await metadata.set("progress", 100);

      logger.info("Assembly simulation completed successfully", {
        projectId,
        stepCount: stepsToInsert.length,
        stuckParts: result.result.stuck_parts,
      });

      return {
        success: true,
        projectId,
        stepCount: stepsToInsert.length,
        stuckParts: result.result.stuck_parts,
        simulationTimeMs: result.result.simulation_time_ms,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Assembly simulation failed", { projectId, error: errorMessage });

      await metadata.set("status", "failed");
      await metadata.set("error", errorMessage);

      // Update project status to failed
      await client
        .from("assemblyProject")
        .update({
          status: "failed",
          simulationStatus: "failed",
          simulationError: errorMessage,
        })
        .eq("id", projectId);

      throw error;
    }
  },
});
