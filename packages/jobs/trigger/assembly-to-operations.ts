import { getCarbonServiceRole } from "@carbon/auth";
import { task, logger } from "@trigger.dev/sdk";

/**
 * Assembly node structure from parsed STEP file
 */
interface AssemblyNode {
  id: string;
  name: string;
  partNumber?: string;
  quantity: number;
  children: AssemblyNode[];
}

interface AssemblyMetadata {
  isAssembly: boolean;
  partCount: number;
  hierarchy: AssemblyNode[];
  rootName?: string;
}

interface GeneratedOperation {
  description: string;
  order: number;
  modelUploadId: string;
  steps: GeneratedStep[];
}

interface GeneratedStep {
  name: string;
  assemblyNodeId: string;
  assemblyNodeName: string;
  assemblyNodeQuantity: number;
  sortOrder: number;
}

/**
 * Traverse assembly hierarchy and generate operations in bottom-up order.
 * Each assembly node with children becomes an operation.
 * Each child becomes a step in that operation.
 */
function generateOperationsFromHierarchy(
  hierarchy: AssemblyNode[],
  modelUploadId: string
): GeneratedOperation[] {
  const operations: GeneratedOperation[] = [];
  let operationOrder = 1;

  // Recursive function to process nodes depth-first (bottom-up assembly)
  function processNode(node: AssemblyNode, path: string): void {
    // First, process all children (depth-first)
    node.children.forEach((child, index) => {
      const childPath = path ? `${path}.children.${index}` : `${index}`;
      processNode(child, childPath);
    });

    // If this node has children, it's an assembly step - create an operation
    if (node.children.length > 0) {
      const steps: GeneratedStep[] = node.children.map((child, index) => ({
        name: `Install ${child.name}${child.quantity > 1 ? ` (×${child.quantity})` : ""}`,
        assemblyNodeId: path ? `${path}.children.${index}` : `${index}`,
        assemblyNodeName: child.name,
        assemblyNodeQuantity: child.quantity,
        sortOrder: index + 1,
      }));

      operations.push({
        description: `Assemble ${node.name}`,
        order: operationOrder++,
        modelUploadId,
        steps,
      });
    }
  }

  // Process each root node
  hierarchy.forEach((rootNode, index) => {
    processNode(rootNode, `${index}`);
  });

  return operations;
}

/**
 * Trigger.dev task to generate job operations from assembly metadata
 */
export const assemblyToOperationsTask = task({
  id: "assembly-to-operations",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: {
    jobId: string;
    modelUploadId: string;
    processId: string;
    companyId: string;
    userId: string;
  }) => {
    const { jobId, modelUploadId, processId, companyId, userId } = payload;

    logger.info("Starting assembly-to-operations task", {
      jobId,
      modelUploadId,
      processId,
    });

    const client = getCarbonServiceRole();

    // Get the job and its make method
    const { data: job, error: jobError } = await client
      .from("job")
      .select("id, jobMakeMethod(id)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error("Failed to fetch job", {
        jobId,
        error: jobError?.message ?? "Job not found",
      });
      throw new Error(`Failed to fetch job: ${jobError?.message}`);
    }

    const jobMakeMethod = Array.isArray(job.jobMakeMethod)
      ? job.jobMakeMethod[0]
      : job.jobMakeMethod;

    if (!jobMakeMethod) {
      console.error("Job does not have a make method", { jobId });
      throw new Error("Job does not have a make method");
    }

    // Get the model upload with assembly metadata
    const { data: modelUpload, error: modelError } = await client
      .from("modelUpload")
      .select("id, assemblyMetadata, parsingStatus")
      .eq("id", modelUploadId)
      .single();

    if (modelError || !modelUpload) {
      console.error("Failed to fetch model upload", {
        modelUploadId,
        error: modelError?.message ?? "Model upload not found",
      });
      throw new Error(`Failed to fetch model upload: ${modelError?.message}`);
    }

    if (modelUpload.parsingStatus !== "completed") {
      console.error("Model upload parsing not complete", {
        modelUploadId,
        parsingStatus: modelUpload.parsingStatus,
      });
      throw new Error(
        `Model upload parsing not complete. Status: ${modelUpload.parsingStatus}`
      );
    }

    const assemblyMetadata = modelUpload.assemblyMetadata as AssemblyMetadata | null;

    if (!assemblyMetadata || !assemblyMetadata.isAssembly) {
      console.error("Model upload does not contain assembly metadata", {
        modelUploadId,
        hasMetadata: !!assemblyMetadata,
        isAssembly: assemblyMetadata?.isAssembly,
      });
      throw new Error("Model upload does not contain assembly metadata");
    }

    logger.info("Found assembly metadata", {
      partCount: assemblyMetadata.partCount,
      rootName: assemblyMetadata.rootName,
      hierarchyLength: assemblyMetadata.hierarchy.length,
    });

    // Generate operations from hierarchy
    const generatedOperations = generateOperationsFromHierarchy(
      assemblyMetadata.hierarchy,
      modelUploadId
    );

    logger.info("Generated operations", {
      count: generatedOperations.length,
    });

    if (generatedOperations.length === 0) {
      logger.warn("No operations generated from assembly");
      return {
        success: true,
        jobId,
        operationsCreated: 0,
        stepsCreated: 0,
      };
    }

    // Get existing operations to determine starting order
    const { data: existingOps } = await client
      .from("jobOperation")
      .select("order")
      .eq("jobId", jobId)
      .order("order", { ascending: false })
      .limit(1);

    const startingOrder = existingOps?.[0]?.order ?? 0;

    let totalStepsCreated = 0;

    // Create operations and steps
    for (const genOp of generatedOperations) {
      // Insert the operation
      const { data: operation, error: opError } = await client
        .from("jobOperation")
        .insert({
          jobId,
          jobMakeMethodId: jobMakeMethod.id,
          processId,
          description: genOp.description,
          order: startingOrder + genOp.order,
          modelUploadId: genOp.modelUploadId,
          companyId,
          createdBy: userId,
        })
        .select("id")
        .single();

      if (opError || !operation) {
        logger.error("Failed to create operation", {
          error: opError?.message,
          description: genOp.description,
        });
        continue;
      }

      logger.info("Created operation", {
        operationId: operation.id,
        description: genOp.description,
      });

      // Insert steps for this operation
      if (genOp.steps.length > 0) {
        const stepsToInsert = genOp.steps.map((step) => ({
          operationId: operation.id,
          name: step.name,
          type: "Checkbox" as const,
          sortOrder: step.sortOrder,
          assemblyNodeId: step.assemblyNodeId,
          assemblyNodeName: step.assemblyNodeName,
          assemblyNodeQuantity: step.assemblyNodeQuantity,
          companyId,
          createdBy: userId,
        }));

        const { error: stepsError } = await client
          .from("jobOperationStep")
          .insert(stepsToInsert);

        if (stepsError) {
          logger.error("Failed to create steps", {
            error: stepsError.message,
            operationId: operation.id,
          });
        } else {
          totalStepsCreated += genOp.steps.length;
          logger.info("Created steps", {
            operationId: operation.id,
            count: genOp.steps.length,
          });
        }
      }
    }

    logger.info("Assembly-to-operations completed", {
      jobId,
      operationsCreated: generatedOperations.length,
      stepsCreated: totalStepsCreated,
    });

    return {
      success: true,
      jobId,
      operationsCreated: generatedOperations.length,
      stepsCreated: totalStepsCreated,
    };
  },
});
