import { requirePermissions } from "@carbon/auth/auth.server";
import type { assemblyToOperationsTask } from "@carbon/jobs/trigger/assembly-to-operations";
import { tasks } from "@trigger.dev/sdk";
import { type ActionFunctionArgs, data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const jobId = formData.get("jobId") as string;
  const modelUploadId = formData.get("modelUploadId") as string;
  const processId = formData.get("processId") as string;

  if (!jobId) {
    return data({ error: "Job ID is required" }, { status: 400 });
  }
  if (!modelUploadId) {
    return data({ error: "Model upload ID is required" }, { status: 400 });
  }
  if (!processId) {
    return data({ error: "Process ID is required" }, { status: 400 });
  }

  // Verify the job exists and belongs to this company
  const { data: job, error: jobError } = await client
    .from("job")
    .select("id, companyId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();

  if (jobError || !job) {
    return data({ error: "Job not found" }, { status: 404 });
  }

  // Verify the model upload exists and has completed parsing
  const { data: modelUpload, error: modelError } = await client
    .from("modelUpload")
    .select("id, parsingStatus, assemblyMetadata")
    .eq("id", modelUploadId)
    .single();

  if (modelError || !modelUpload) {
    return data({ error: "Model upload not found" }, { status: 404 });
  }

  if (modelUpload.parsingStatus !== "completed") {
    return data(
      {
        error: `Model parsing not complete. Status: ${modelUpload.parsingStatus}`
      },
      { status: 400 }
    );
  }

  const assemblyMetadata = modelUpload.assemblyMetadata as {
    isAssembly: boolean;
  } | null;

  if (!assemblyMetadata?.isAssembly) {
    return data(
      { error: "Model upload does not contain assembly data" },
      { status: 400 }
    );
  }

  // Verify the process exists
  const { data: process, error: processError } = await client
    .from("process")
    .select("id")
    .eq("id", processId)
    .eq("companyId", companyId)
    .single();

  if (processError || !process) {
    return data({ error: "Process not found" }, { status: 404 });
  }

  // Trigger the background job
  await tasks.trigger<typeof assemblyToOperationsTask>(
    "assembly-to-operations",
    {
      jobId,
      modelUploadId,
      processId,
      companyId,
      userId
    }
  );

  return data({
    success: true,
    message: "Work instructions generation started"
  });
}
