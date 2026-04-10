import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

export const mrpFunction = inngest.createFunction(
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
            console.error(
              `Failed to run MRP for company ${company.name}: ${
                result.error instanceof Error
                  ? result.error.message
                  : String(result.error)
              }`
            );
          } else {
            console.log(`Successfully ran MRP for company ${company.name}`);
          }
        } catch (error) {
          console.error(
            `Unexpected error in MRP run task: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    });
  }
);
