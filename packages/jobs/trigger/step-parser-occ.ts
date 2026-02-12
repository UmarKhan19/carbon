import { getCarbonServiceRole } from "@carbon/auth";
import { task, logger, metadata, tasks } from "@trigger.dev/sdk";
import type { assemblySimulateTask } from "./assembly-simulate";

/**
 * Assembly node from OpenCascade parser
 */
interface AssemblyNode {
  id: string;
  name: string;
  type: "assembly" | "part";
  children: AssemblyNode[];
  transform?: number[];
  color?: number[];
}

/**
 * Response from CAD Service /parse endpoint
 */
interface CadServiceResponse {
  success: boolean;
  hierarchy?: AssemblyNode;
  glb_base64?: string;
  part_count: number;
  parse_time_ms: number;
  error?: string;
}

/**
 * Trigger.dev task to parse STEP files using OpenCascade (PythonOCC)
 *
 * This task:
 * 1. Downloads the STEP file from Supabase Storage
 * 2. Sends it to the CAD Service for parsing
 * 3. Uploads the resulting GLB to storage
 * 4. Updates the assemblyProject with hierarchy and model path
 */
export const stepParserOccTask = task({
  id: "step-parser-occ",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 60000,
  },
  run: async (payload: {
    projectId: string;
    companyId: string;
    storagePath: string;
  }) => {
    const { projectId, companyId, storagePath } = payload;

    logger.info("Starting OpenCascade STEP parser", {
      projectId,
      companyId,
      storagePath,
    });

    const client = getCarbonServiceRole();
    const cadServiceUrl =
      process.env.CAD_SERVICE_URL || "http://localhost:8000";

    console.log(" CAD Service", { cadServiceUrl });

    // Update status to processing
    await metadata.set("status", "downloading");
    await metadata.set("progress", 10);

    const { error: statusError } = await client
      .from("assemblyProject")
      .update({
        status: "parsing",
        parsingProgress: 10,
        parsingError: null,
      })
      .eq("id", projectId);

    if (statusError) {
      logger.error("Failed to update status to processing", {
        projectId,
        error: statusError.message,
      });
    }

    try {
      // 1. Download the STEP file from storage
      logger.info("Downloading STEP file", { storagePath });
      const { data: fileData, error: downloadError } = await client.storage
        .from("private")
        .download(storagePath);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download file: ${downloadError?.message}`);
      }

      const fileSize = fileData.size;
      logger.info("File downloaded", { size: fileSize });

      await metadata.set("status", "parsing");
      await metadata.set("progress", 30);

      await client
        .from("assemblyProject")
        .update({ parsingProgress: 30 })
        .eq("id", projectId);

      // 2. Send to CAD Service for parsing
      logger.info("Sending to CAD Service", { cadServiceUrl });

      const formData = new FormData();
      formData.append("file", fileData, "model.step");
      formData.append("tolerance", "0.1");
      formData.append("angular_tolerance", "0.5");

      const response = await fetch(`${cadServiceUrl}/parse`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CAD Service error (${response.status}): ${errorText}`);
      }

      const result: CadServiceResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || "CAD Service parsing failed");
      }

      logger.info("CAD Service parsing complete", {
        partCount: result.part_count,
        parseTimeMs: result.parse_time_ms,
      });

      await metadata.set("status", "uploading");
      await metadata.set("progress", 70);

      await client
        .from("assemblyProject")
        .update({ parsingProgress: 70 })
        .eq("id", projectId);

      // 3. Upload GLB to storage
      if (!result.glb_base64) {
        throw new Error("CAD Service did not return GLB data");
      }

      const glbBuffer = Buffer.from(result.glb_base64, "base64");
      const glbPath = `${companyId}/assembly/${projectId}/model.glb`;

      logger.info("Uploading GLB to storage", {
        glbPath,
        size: glbBuffer.length,
      });

      const { error: uploadError } = await client.storage
        .from("private")
        .upload(glbPath, glbBuffer, {
          contentType: "model/gltf-binary",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload GLB: ${uploadError.message}`);
      }

      await metadata.set("status", "finalizing");
      await metadata.set("progress", 90);

      // 4. Update assemblyProject with results and chain simulation
      const { error: updateError } = await client
        .from("assemblyProject")
        .update({
          status: "simulating",
          simulationStatus: "pending",
          assemblyTree: result.hierarchy,
          originalAssemblyTree: result.hierarchy,
          modelPath: glbPath,
          parsingProgress: 100,
          parsingError: null,
        })
        .eq("id", projectId);

      if (updateError) {
        throw new Error(`Failed to update project: ${updateError.message}`);
      }

      // Auto-chain: trigger simulation immediately after parse
      await tasks.trigger<typeof assemblySimulateTask>("assembly-simulate", {
        projectId,
        companyId,
      });

      await metadata.set("status", "simulation-triggered");
      await metadata.set("progress", 100);

      logger.info("STEP parsing completed, simulation triggered", {
        projectId,
        partCount: result.part_count,
        glbPath,
      });

      return {
        success: true,
        projectId,
        partCount: result.part_count,
        glbPath,
        parseTimeMs: result.parse_time_ms,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("STEP parsing failed", { projectId, error: errorMessage });

      await metadata.set("status", "failed");
      await metadata.set("error", errorMessage);

      // Update status to failed
      await client
        .from("assemblyProject")
        .update({
          status: "failed",
          parsingError: errorMessage,
        })
        .eq("id", projectId);

      throw error;
    }
  },
});
