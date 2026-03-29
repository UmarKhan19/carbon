import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { task } from "@trigger.dev/sdk";
import { z } from "zod";

const serviceRole = getCarbonServiceRole();

const scheduleJobSchema = z.object({
  jobId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  mode: z.enum(["initial", "reschedule"]).default("reschedule"),
  direction: z.enum(["backward", "forward"]).default("backward"),
});

/**
 * Unified scheduling task that handles both initial scheduling and rescheduling.
 * Uses the new unified scheduling engine endpoint.
 */
export const scheduleJob = task({
  id: "schedule-job",
  queue: {
    name: "scheduling",
    concurrencyLimit: 5,
  },
  run: async (payload: z.infer<typeof scheduleJobSchema>) => {
    const { jobId, companyId, userId, mode, direction } = payload;
    console.info(
      `🔰 ${mode === "initial" ? "Scheduling" : "Rescheduling"} job ${jobId}`
    );

    try {
      const { data, error } = await serviceRole.functions.invoke("schedule", {
        body: {
          jobId,
          companyId,
          userId,
          mode,
          direction,
        },
      });

      if (error) {
        throw new Error(error.message || `Failed to ${mode} schedule job`);
      }

      console.info(
        `✅ ${mode === "initial" ? "Scheduled" : "Rescheduled"}: ` +
          `${data.operationsScheduled} ops, ` +
          `${data.workCentersAffected.length} WCs, ` +
          `${data.conflictsDetected} conflicts`
      );

      return {
        success: true,
        operationsScheduled: data.operationsScheduled,
        conflictsDetected: data.conflictsDetected,
        workCentersAffected: data.workCentersAffected,
        assemblyDepth: data.assemblyDepth,
      };
    } catch (error) {
      console.error(
        `❌ ${mode === "initial" ? "Scheduling" : "Rescheduling"} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error; // Let Trigger.dev handle retries
    }
  },
});
