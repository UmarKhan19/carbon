import { trigger } from "@carbon/jobs";

/**
 * Triggers a job scheduling task via inngest.
 * Supports both initial scheduling and rescheduling.
 */
export async function triggerJobSchedule(
  jobId: string,
  companyId: string,
  userId: string,
  mode: "initial" | "reschedule" = "reschedule",
  direction: "backward" | "forward" = "backward"
) {
  const result = await trigger("schedule-job", {
    jobId,
    companyId,
    userId,
    mode,
    direction
  });

  return { success: true, runId: result.ids[0] };
}

/**
 * @deprecated Use triggerJobSchedule with mode="reschedule" instead.
 */
export async function triggerJobReschedule(
  jobId: string,
  companyId: string,
  userId: string
) {
  return triggerJobSchedule(jobId, companyId, userId, "reschedule", "backward");
}
