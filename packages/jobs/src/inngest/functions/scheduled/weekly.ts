import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { NotificationEvent } from "@carbon/notifications";
import { Edition } from "@carbon/utils";
import { inngest } from "../../client";

export const weeklyFunction = inngest.createFunction(
  { id: "weekly", retries: 2 },
  { cron: "0 21 * * 0" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("cloud-cleanup", async () => {
      logger.info("Starting weekly tasks");

      try {
        if (process.env.CARBON_EDITION === Edition.Cloud) {
          const bypassUrl = `${process.env.VERCEL_URL}/api/settings/bypass`;
          const bypassResponse = await fetch(bypassUrl);
          if (!bypassResponse.ok) {
            logger.error("Failed to fetch bypass list", {
              statusText: bypassResponse.statusText
            });
            return;
          }
          const bypassData = (await bypassResponse.json()) as {
            bypassList?: string[];
          };
          const bypassList = bypassData.bypassList ?? [];

          logger.info("Bypass list", { bypassList });

          // Get all companies
          const { data: companies, error: companiesError } = await serviceRole
            .from("company")
            .select("id, name, createdAt");

          if (companiesError) {
            logger.error("Failed to fetch companies", {
              error: companiesError
            });
            return;
          }

          logger.info("Found companies", { count: companies?.length || 0 });

          // Get all company plans
          const { data: companyPlans, error: plansError } = await serviceRole
            .from("companyPlan")
            .select("id, stripeSubscriptionStatus");

          if (plansError) {
            logger.error("Failed to fetch company plans", {
              error: plansError
            });
            return;
          }

          // Create a map of company plans for quick lookup
          const planMap = new Map(
            companyPlans?.map((plan) => [
              plan.id,
              plan.stripeSubscriptionStatus
            ]) || []
          );

          // Filter companies to delete
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

          const companiesToDelete =
            companies?.filter((company) => {
              if (planMap.get(company.id) === "Canceled") {
                return true;
              }

              if (bypassList.includes(company.id)) {
                return false;
              }

              if (planMap.get(company.id)) {
                return false;
              }

              // Keep companies created in the last week
              const createdAt = new Date(company.createdAt);
              if (createdAt > oneWeekAgo) {
                return false;
              }

              // Delete this company
              return true;
            }) || [];

          logger.info("Companies to delete", {
            count: companiesToDelete.length
          });

          const { error: deletedCompaniesError } = await serviceRole
            .from("company")
            .delete()
            .in(
              "id",
              companiesToDelete.map((company) => company.id)
            );

          if (deletedCompaniesError) {
            logger.error("Failed to delete companies", {
              error: deletedCompaniesError
            });
            return;
          } else {
            logger.info("Deleted companies", {
              count: companiesToDelete.length
            });
            for (const company of companiesToDelete) {
              logger.info("Deleted company", { company: company.name });
            }
          }

          // Drop search index tables for companies being deleted
          for (const company of companiesToDelete) {
            const { error: dropSearchError } = await serviceRole.rpc(
              "drop_company_search_index",
              { p_company_id: company.id }
            );
            if (dropSearchError) {
              logger.error("Failed to drop search index for company", {
                company: company.name,
                error: dropSearchError
              });
            } else {
              logger.info("Dropped search index for company", {
                company: company.name
              });
            }
          }
        }
      } catch (error) {
        logger.error("Unexpected error in cloud cleanup", { error });
      }
    });

    await step.run("notify-outstanding-trainings", async () => {
      // Notify employees with outstanding trainings (Pending or Overdue)
      logger.info("Checking for outstanding training assignments");

      try {
        // Get all companies with training assignments
        const { data: companiesWithTrainings, error: companiesError } =
          await serviceRole
            .from("trainingAssignment")
            .select("companyId")
            .limit(1000);

        if (companiesError) {
          logger.error("Failed to fetch companies with trainings", {
            error: companiesError
          });
          return;
        }

        const uniqueCompanyIds = [
          ...new Set(companiesWithTrainings?.map((c) => c.companyId) ?? [])
        ];

        logger.info("Found companies with training assignments", {
          count: uniqueCompanyIds.length
        });

        let totalNotifications = 0;

        for (const companyId of uniqueCompanyIds) {
          const { data: trainingStatus, error: trainingsError } =
            await serviceRole.rpc("get_training_assignment_status", {
              p_company_id: companyId
            });

          if (trainingsError) {
            logger.error("Failed to fetch trainings for company", {
              companyId,
              error: trainingsError
            });
            continue;
          }

          // Filter to pending/overdue and dedupe by employee+assignment
          const outstandingTrainings = (trainingStatus ?? []).filter(
            (t) => t.status === "Pending" || t.status === "Overdue"
          );

          // Group by trainingAssignmentId to send one notification per assignment per employee
          const assignmentsByEmployee = new Map<
            string,
            {
              trainingAssignmentId: string;
              employeeId: string;
              companyId: string;
              trainingName: string;
              status: string;
            }
          >();

          for (const training of outstandingTrainings) {
            const key = `${training.companyId}:${training.employeeId}:${training.trainingAssignmentId}`;
            if (!assignmentsByEmployee.has(key)) {
              assignmentsByEmployee.set(key, training);
            }
          }

          // Send notifications for each unique employee-assignment combination
          for (const [, assignment] of assignmentsByEmployee) {
            try {
              await inngest.send({
                name: "carbon/notify",
                data: {
                  companyId: assignment.companyId,
                  documentId: assignment.trainingAssignmentId,
                  event: NotificationEvent.TrainingAssignment,
                  recipient: {
                    type: "user" as const,
                    userId: assignment.employeeId
                  }
                }
              });
              logger.info("Sent training reminder", {
                training: assignment.trainingName,
                employeeId: assignment.employeeId
              });
              totalNotifications++;
            } catch (err) {
              logger.error("Failed to send training reminder", {
                error: err
              });
            }
          }
        }

        logger.info("Sent training reminder notifications", {
          count: totalNotifications
        });
      } catch (error) {
        logger.error("Unexpected error in training notifications", { error });
      }

      logger.info("Weekly tasks completed");
    });
  }
);
