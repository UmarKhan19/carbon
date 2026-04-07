import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { sendToProxyBox, updatePrintJobStatus } from "@carbon/printing";
import { AbortTaskRunError, task } from "@trigger.dev/sdk";

export const printJobDeliver = task({
  id: "print-job-deliver",
  retry: {
    maxAttempts: 3,
    factor: 2,
    randomize: true,
  },
  run: async (payload: { printJobId: string; companyId: string }) => {
    const client = getCarbonServiceRole();
    const { printJobId, companyId } = payload;

    // Read print job
    const { data: job, error: jobError } = await client
      .from("printJob")
      .select("id, content, contentType, printerUrl, status, attempts")
      .eq("id", printJobId)
      .eq("companyId", companyId)
      .single();

    if (jobError || !job) {
      throw new Error(`Print job not found: ${printJobId}`);
    }

    if (!job.content || !job.contentType) {
      await updatePrintJobStatus(client, printJobId, companyId, "failed", {
        error: "Print job has no content",
      });
      throw new AbortTaskRunError("Print job has no content");
    }

    // Resolve API key fresh from printerRoute (not stored on job)
    const { data: route } = await client
      .from("printerRoute")
      .select("apiKey")
      .eq("printerUrl", job.printerUrl)
      .eq("companyId", companyId)
      .limit(1)
      .maybeSingle();

    const apiKey = route?.apiKey;

    // Mark as printing and increment attempts
    await client
      .from("printJob")
      .update({
        status: "printing",
        attempts: (job.attempts ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", printJobId)
      .eq("companyId", companyId);

    try {
      // Decode content if PDF (stored as base64)
      const content =
        job.contentType === "pdf"
          ? Buffer.from(job.content, "base64")
          : job.content;

      await sendToProxyBox({
        url: job.printerUrl,
        apiKey,
        content,
      });

      // Mark as completed
      await updatePrintJobStatus(client, printJobId, companyId, "completed");

      return { success: true };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown delivery error";

      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" ||
          errorMessage.includes("aborted") ||
          errorMessage.includes("timeout"));

      // Mark as failed
      await updatePrintJobStatus(client, printJobId, companyId, "failed", {
        error: errorMessage,
      });

      if (isTimeout) {
        // Don't retry on timeout — content was likely already delivered
        // to the print server. Retrying would print duplicate copies.
        throw new AbortTaskRunError(
          `Delivery timed out — content may have been printed. ${errorMessage}`
        );
      }

      // Re-throw to trigger retry for non-timeout errors (connection refused, etc.)
      throw err;
    }
  },
});
