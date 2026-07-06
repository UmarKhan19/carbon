import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { GEOMETRY_SERVICE_API_KEY, GEOMETRY_SERVICE_URL } from "@carbon/env";
import { inngest } from "../../client";
import { loadPlanUnits } from "./plan-units";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds
// Every geometry HTTP call is now short (submit or a status poll), so a tight
// per-request timeout is safe and catches a genuinely unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// Large assemblies can plan for 10+ minutes. Poll the async job on this cadence
// up to this many times; exceeding it fails the job (→ onFailure → Failed → the
// UI offers a retry) rather than waiting forever.
const PLAN_POLL_INTERVAL = "15s";
const PLAN_MAX_POLLS = 120; // 15s × 120 = 30 min budget

const authHeaders: Record<string, string> = GEOMETRY_SERVICE_API_KEY
  ? { Authorization: `Bearer ${GEOMETRY_SERVICE_API_KEY}` }
  : {};

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
        .select("id, modelPath, graphPath, processingStatus")
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

      return {
        id: planJob.data.id,
        modelPath: modelUpload.data.modelPath,
        graphPath: modelUpload.data.graphPath
      };
    });

    if (!GEOMETRY_SERVICE_URL) {
      throw new Error("GEOMETRY_SERVICE_URL is not configured");
    }
    const geometryUrl = GEOMETRY_SERVICE_URL;

    // Collapse the model's leaf soup into the units the planner should treat as
    // rigid bodies (e.g. a purchased PCB → one body) BEFORE submitting, so a
    // 400-part model plans as its ~7 assembled units. Best-effort: no units →
    // every leaf is planned, exactly as before.
    const units = await step.run("derive-units", () =>
      loadPlanUnits({ modelUploadId, companyId, graphPath: job.graphPath })
    );

    // Kick off the planner. The service starts it in the background and returns
    // immediately, so the request is short — no connection is held open across
    // the multi-minute run (which no HTTP hop survives).
    await step.run("start-plan", async () => {
      const client = getCarbonServiceRole();

      const source = await client.storage
        .from("private")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }

      const response = await fetch(`${geometryUrl}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          jobId: job.id,
          source: { url: source.data.signedUrl, format: "step" },
          ...(units.length > 0 ? { options: { units } } : {})
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error ?? `Geometry service returned ${response.status}`
        );
      }
    });

    // Poll the async job until it finishes. Each poll is its own short step, so
    // Inngest sleeps between them rather than holding a request open, and a
    // retry resumes from the last poll instead of re-running the planner.
    let plan: Json | null = null;
    let stats: Json = null;
    for (let attempt = 0; attempt < PLAN_MAX_POLLS; attempt++) {
      await step.sleep(`plan-wait-${attempt}`, PLAN_POLL_INTERVAL);

      const status = await step.run(`plan-poll-${attempt}`, async () => {
        const response = await fetch(`${geometryUrl}/plan/${job.id}`, {
          headers: authHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          status?: string;
          plan?: Json;
          stats?: Record<string, unknown>;
          error?: string;
        } | null;
        if (!response.ok || !body?.ok) {
          throw new Error(
            body?.error ?? `Geometry status check returned ${response.status}`
          );
        }
        return body;
      });

      if (status.status === "done") {
        if (status.plan == null) {
          throw new Error("Planner reported done but returned no plan");
        }
        plan = status.plan;
        stats = (status.stats ?? null) as Json;
        break;
      }
      if (status.status === "error") {
        throw new Error(status.error ?? "Motion planning failed");
      }
    }

    if (plan == null) {
      throw new Error("Motion planning did not finish in time");
    }
    const planData = plan;

    await step.run("persist-plan", async () => {
      const client = getCarbonServiceRole();
      const planPath = `${companyId}/models/${modelUploadId}/${job.id}/plan.json`;

      const upload = await client.storage
        .from("private")
        .upload(planPath, JSON.stringify(planData), {
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
          stats,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id);
    });
  }
);
