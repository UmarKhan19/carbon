import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { FunctionsResponse } from "@supabase/functions-js";
import { FunctionRegion } from "@supabase/supabase-js";
import { inngest } from "../../client";

export const recalculateFunction = inngest.createFunction(
  { id: "recalculate", retries: 3 },
  { event: "carbon/recalculate" },
  async ({ event, step }) => {
    const payload = event.data;

    const result = await step.run("recalculate", async () => {
      console.info(`Type: ${payload.type}, id: ${payload.id}`);

      const serviceRole = getCarbonServiceRole();
      let calculateQuantities: FunctionsResponse<{ success: boolean }>;

      switch (payload.type) {
        case "jobRequirements":
          console.info(`Recalculating job requirements for ${payload.id}`);
          calculateQuantities = await recalculateJobRequirements(serviceRole, {
            id: payload.id,
            companyId: payload.companyId,
            userId: payload.userId
          });

          return {
            success: !calculateQuantities.error,
            message: calculateQuantities.error?.message
          };

        case "jobMakeMethodRequirements":
          console.info(
            `Recalculating job make method requirements for ${payload.id}`
          );
          calculateQuantities = await recalculateJobMakeMethodRequirements(
            serviceRole,
            {
              id: payload.id,
              companyId: payload.companyId,
              userId: payload.userId
            }
          );

          return {
            success: !calculateQuantities.error,
            message: calculateQuantities.error?.message
          };

        default:
          return {
            success: false,
            message: `Unknown recalculation type: ${payload.type}`
          };
      }
    });

    if (result.success) {
      console.info(`Success ${payload.id}`);
    } else {
      console.error(
        `Recalculation ${payload.type} failed for ${payload.id}: ${result.message}`
      );
    }

    return result;
  }
);

async function recalculateJobRequirements(
  client: ReturnType<typeof getCarbonServiceRole>,
  params: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("recalculate", {
    body: {
      type: "jobRequirements",
      ...params
    }
  });
}

async function recalculateJobMakeMethodRequirements(
  client: ReturnType<typeof getCarbonServiceRole>,
  params: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("schedule", {
    body: {
      mode: "initial",
      direction: "backward",
      jobId: params.id,
      companyId: params.companyId,
      userId: params.userId
    },
    region: FunctionRegion.UsEast1
  });
}
