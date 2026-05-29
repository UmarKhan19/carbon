import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { extractEdgeError, postInternalAlert } from "@carbon/lib/alerts.server";
import { defineFunction } from "../../client";

export const mrpFunction = defineFunction(
  { id: "mrp", retries: 2 },
  { cron: "0 */3 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("run-mrp-for-all-companies", async () => {
      console.log(
        `Scheduled MRP Calculation Started: ${new Date().toISOString()}`
      );

      const companies = await serviceRole
        .from("companyPlan")
        .select("id, ...company(name)");

      if (companies.error) {
        console.error(
          `Failed to get companies: ${
            companies.error instanceof Error
              ? companies.error.message
              : String(companies.error)
          }`
        );
        await postInternalAlert({
          source: "inngest:mrp",
          error: companies.error,
          context: { step: "fetch-companies" }
        });
        return;
      }

      for (const company of companies.data) {
        try {
          const result = await serviceRole.functions.invoke("mrp", {
            body: {
              type: "company",
              id: company.id,
              companyId: company.id,
              userId: "system"
            }
          });

          if (result.error) {
            const edgeError = await extractEdgeError(result.error);
            console.error(
              `Failed to run MRP for company ${company.name}: ${
                edgeError instanceof Error
                  ? edgeError.message
                  : JSON.stringify(edgeError)
              }`
            );
            await postInternalAlert({
              source: "inngest:mrp",
              error: edgeError,
              context: {
                companyId: company.id,
                companyName: company.name
              }
            });
          } else {
            console.log(`Successfully ran MRP for company ${company.name}`);
          }
        } catch (error) {
          console.error(
            `Unexpected error in MRP run task: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await postInternalAlert({
            source: "inngest:mrp",
            error,
            context: {
              companyId: company.id,
              companyName: company.name
            }
          });
        }
      }
    });
  }
);
