/**
 * Triggers a job scheduling task via Trigger.dev.
 * Supports both initial scheduling and rescheduling.
 */
export async function triggerJobSchedule(
  jobId: string,
  companyId: string,
  userId: string,
  mode: "initial" | "reschedule" = "reschedule",
  direction: "backward" | "forward" = "backward"
) {
  const { scheduleJob } = await import("@carbon/jobs/trigger/reschedule-job");

  const handle = await scheduleJob.trigger({
    jobId,
    companyId,
    userId,
    mode,
    direction
  });

  return { success: true, runId: handle.id };
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
