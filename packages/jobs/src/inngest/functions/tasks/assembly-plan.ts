import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { GEOMETRY_SERVICE_API_KEY, GEOMETRY_SERVICE_URL } from "@carbon/env";
import { inngest } from "../../client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds
// The planner can run for several minutes on large assemblies. Bound the call
// so a genuinely hung request fails cleanly (→ onFailure marks the job Failed →
// the UI offers a retry) instead of pinning the job in "Processing" forever.
const PLAN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs the geometry service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored
 * as plan.json next to the model artifacts. See
 * docs/specs/animated-work-instructions-contracts.md (POST /plan).
 */
export const assemblyPlanFunction = inngest.createFunction(
  {
    id: "assembly-plan",
    retries: 2,
    concurrency: [{ limit: 4 }, { key: "event.data.companyId", limit: 1 }],
    onFailure: async ({ event }) => {
      const { modelUploadId } = event.data.event.data;
      const client = getCarbonServiceRole();

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Failed",
          error: event.data.error.message,
          updatedAt: new Date().toISOString()
        })
        .eq("modelUploadId", modelUploadId)
        .eq("kind", "plan")
        .eq("status", "Processing");
    }
  },
  { event: "carbon/assembly-plan" },
  async ({ event, step }) => {
    const { modelUploadId, companyId, userId } = event.data;

    const job = await step.run("queue", async () => {
      const client = getCarbonServiceRole();

      const modelUpload = await client
        .from("modelUpload")
        .select("id, modelPath, processingStatus")
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .single();

      if (modelUpload.error || !modelUpload.data?.modelPath) {
        throw new Error(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }

      const planJob = await client
        .from("assemblyPlanJob")
        .insert({
          modelUploadId,
          kind: "plan",
          status: "Processing",
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();

      if (planJob.error) {
        throw new Error(
          `Failed to create assembly plan job: ${planJob.error.message}`
        );
      }

      return { id: planJob.data.id, modelPath: modelUpload.data.modelPath };
    });

    await step.run("plan", async () => {
      const client = getCarbonServiceRole();

      if (!GEOMETRY_SERVICE_URL) {
        throw new Error("GEOMETRY_SERVICE_URL is not configured");
      }

      const planPath = `${companyId}/models/${modelUploadId}/${job.id}/plan.json`;

      const source = await client.storage
        .from("private")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }

      const response = await fetch(`${GEOMETRY_SERVICE_URL}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(GEOMETRY_SERVICE_API_KEY
            ? { Authorization: `Bearer ${GEOMETRY_SERVICE_API_KEY}` }
            : {})
        },
        body: JSON.stringify({
          jobId: job.id,
          source: {
            url: source.data.signedUrl,
            format: "step"
          }
        }),
        signal: AbortSignal.timeout(PLAN_TIMEOUT_MS)
      });

      const result = (await response.json().catch(() => null)) as {
        ok: boolean;
        plan?: Json;
        partCount?: number;
        plannedCount?: number;
        stats?: Record<string, unknown>;
        error?: string;
      } | null;

      if (!response.ok || !result?.ok || result.plan == null) {
        throw new Error(
          result?.error ?? `Geometry service returned ${response.status}`
        );
      }

      // Persist the plan ourselves now that the planner has returned. The
      // service used to upload via a pre-signed URL, but that URL is minted
      // before the multi-minute run and expires (60s TTL) long before the
      // planner finishes — the upload then 400s and the job never completes.
      const upload = await client.storage
        .from("private")
        .upload(planPath, JSON.stringify(result.plan), {
          contentType: "application/json",
          upsert: true
        });
      if (upload.error) {
        throw new Error(`Failed to upload plan: ${upload.error.message}`);
      }

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          planPath,
          stats: (result.stats ?? null) as Json,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id);
    });
  }
);
