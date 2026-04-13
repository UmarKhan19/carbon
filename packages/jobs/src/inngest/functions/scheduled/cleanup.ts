import { NOVU_API_URL, NOVU_SECRET_KEY } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { TriggerPayload } from "@carbon/notifications";
import {
  getSubscriberId,
  NotificationEvent,
  NotificationWorkflow,
  triggerBulk
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { inngest } from "../../client";

export const cleanupFunction = inngest.createFunction(
  { id: "cleanup", retries: 2 },
  { cron: "0 7,12,17 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();
    const novu = new Novu(NOVU_SECRET_KEY!, {
      backendUrl: NOVU_API_URL
    });

    await step.run("expire-quotes-and-rfqs", async () => {
      console.log(`Starting cleanup tasks: ${new Date().toISOString()}`);

      // Clean up expired quotes
      console.log("Checking for expired quotes...");
      const [expiredQuotes, expiredSupplierQuotes] = await Promise.all([
        serviceRole
          .from("quote")
          .select("*")
          .eq("status", "Sent")
          .not("expirationDate", "is", null)
          .lt("expirationDate", new Date().toISOString()),
        serviceRole
          .from("supplierQuote")
          .select("*")
          .eq("status", "Active")
          .not("expirationDate", "is", null)
          .lt("expirationDate", new Date().toISOString())
      ]);

      if (expiredQuotes.error) {
        console.error(
          `Error fetching expired quotes: ${JSON.stringify(expiredQuotes.error)}`
        );
        return;
      }

      if (expiredSupplierQuotes.error) {
        console.error(
          `Error fetching expired supplier quotes: ${JSON.stringify(
            expiredSupplierQuotes.error
          )}`
        );
        return;
      }

      if (expiredSupplierQuotes.data.length > 0) {
        console.log(
          `Found ${expiredSupplierQuotes.data.length} expired supplier quotes`
        );
        const expireSupplierQuotes = await serviceRole
          .from("supplierQuote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredSupplierQuotes.data.map((quote) => quote.id)
          );

        if (expireSupplierQuotes.error) {
          console.error(
            `Error updating expired supplier quotes: ${JSON.stringify(
              expireSupplierQuotes.error
            )}`
          );
          return;
        }
      } else {
        console.log("No expired supplier quotes found");
      }

      // Auto-expire purchasing RFQs past due date
      console.log("Checking for expired purchasing RFQs...");
      const expiredRfqs = await serviceRole
        .from("purchasingRfq")
        .select("*")
        .in("status", ["Draft", "Requested"])
        .not("expirationDate", "is", null)
        .lt("expirationDate", new Date().toISOString());

      if (expiredRfqs.error) {
        console.error(
          `Error fetching expired RFQs: ${JSON.stringify(expiredRfqs.error)}`
        );
      } else if (expiredRfqs.data.length > 0) {
        console.log(`Found ${expiredRfqs.data.length} expired RFQs`);
        const closeRfqs = await serviceRole
          .from("purchasingRfq")
          .update({ status: "Closed" })
          .in(
            "id",
            expiredRfqs.data.map((rfq) => rfq.id)
          );

        if (closeRfqs.error) {
          console.error(
            `Error closing expired RFQs: ${JSON.stringify(closeRfqs.error)}`
          );
        }
      } else {
        console.log("No expired RFQs found");
      }

      if (!expiredQuotes?.data?.length) {
        console.log("No expired quotes found requiring notification");
      } else {
        console.log(`Found ${expiredQuotes.data.length} expired quotes`);
        const expireQuotes = await serviceRole
          .from("quote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredQuotes.data.map((quote) => quote.id)
          );

        if (expireQuotes.error) {
          console.error(
            `Error updating expired quotes: ${JSON.stringify(
              expireQuotes.error
            )}`
          );
          return;
        }

        const notificationPayloads: TriggerPayload[] = expiredQuotes.data
          .filter((quote) => Boolean(quote.salesPersonId))
          .map((quote) => {
            return {
              workflow: NotificationWorkflow.Expiration,
              payload: {
                documentId: quote.id,
                event: NotificationEvent.QuoteExpired,
                recordId: quote.id,
                description: `Quote ${quote.quoteId} has expired`
              },
              user: {
                subscriberId: getSubscriberId({
                  companyId: quote.companyId,
                  userId: quote.salesPersonId!
                })
              }
            };
          });

        if (notificationPayloads.length > 0) {
          console.log(
            `Triggering ${notificationPayloads.length} notifications`
          );
          try {
            await triggerBulk(novu, notificationPayloads.flat());
          } catch (error) {
            console.error("Error triggering notifications");
            console.error(error);
          }
        } else {
          console.log("No notifications to trigger");
        }
      }
    });

    await step.run("check-gauge-calibration", async () => {
      // Check for gauges going out of calibration
      console.log("Checking for gauges going out of calibration...");
      const outOfCalibrationGauges = await serviceRole
        .from("gauges")
        .select("*")
        .eq("gaugeCalibrationStatusWithDueDate", "Out-of-Calibration")
        .neq("lastCalibrationStatus", "Out-of-Calibration");

      if (outOfCalibrationGauges.error) {
        console.error(
          `Error fetching out of calibration gauges: ${JSON.stringify(
            outOfCalibrationGauges.error
          )}`
        );
      } else if (outOfCalibrationGauges.data.length > 0) {
        console.log(
          `Found ${outOfCalibrationGauges.data.length} gauges going out of calibration`
        );

        // Get unique company IDs
        const companyIds = [
          ...new Set(
            outOfCalibrationGauges.data
              .map((g) => g.companyId)
              .filter((id): id is string => id !== null)
          )
        ];

        // Fetch all company settings at once
        const companySettingsResult = await serviceRole
          .from("companySettings")
          .select("id, gaugeCalibrationExpiredNotificationGroup")
          .in("id", companyIds);

        if (companySettingsResult.error) {
          console.error(
            `Error fetching company settings: ${JSON.stringify(
              companySettingsResult.error
            )}`
          );
        } else {
          // Create a map of companyId -> notification group
          const notificationGroupsByCompany = new Map(
            companySettingsResult.data.map((settings) => [
              settings.id,
              settings.gaugeCalibrationExpiredNotificationGroup ?? []
            ])
          );

          const gaugeNotificationPayloads: TriggerPayload[] = [];

          // Create notification payloads for each gauge
          for (const gauge of outOfCalibrationGauges.data) {
            if (!gauge.companyId || !gauge.id) continue;

            const notificationGroup =
              notificationGroupsByCompany.get(gauge.companyId) ?? [];

            if (notificationGroup.length === 0) {
              console.log(
                `No notification group configured for company ${gauge.companyId}, skipping gauge ${gauge.gaugeId}`
              );
              continue;
            }

            // Create notification payloads for each user in the notification group
            for (const userId of notificationGroup) {
              gaugeNotificationPayloads.push({
                workflow: NotificationWorkflow.GaugeCalibration,
                payload: {
                  event: NotificationEvent.GaugeCalibrationExpired,
                  recordId: gauge.id,
                  description: `Gauge ${gauge.gaugeId} is out of calibration`
                },
                user: {
                  subscriberId: getSubscriberId({
                    companyId: gauge.companyId,
                    userId
                  })
                }
              });
            }
          }

          if (gaugeNotificationPayloads.length > 0) {
            console.log(
              `Triggering ${gaugeNotificationPayloads.length} gauge calibration notifications`
            );
            try {
              await triggerBulk(novu, gaugeNotificationPayloads);

              // Update lastCalibrationStatus for gauges that had notifications sent
              // Extract unique gauge IDs from the notification payloads
              const gaugeIdsToUpdate = [
                ...new Set(
                  gaugeNotificationPayloads.map(
                    (payload) => payload.payload.recordId
                  )
                )
              ];

              const updateGauges = await serviceRole
                .from("gauge")
                .update({ lastCalibrationStatus: "Out-of-Calibration" })
                .in("id", gaugeIdsToUpdate);

              if (updateGauges.error) {
                console.error(
                  `Error updating gauge lastCalibrationStatus: ${JSON.stringify(
                    updateGauges.error
                  )}`
                );
              } else {
                console.log(
                  `Updated lastCalibrationStatus for ${gaugeIdsToUpdate.length} gauges`
                );
              }
            } catch (error) {
              console.error("Error triggering gauge calibration notifications");
              console.error(error);
            }
          } else {
            console.log("No gauge calibration notifications to trigger");
          }
        }
      } else {
        console.log("No gauges going out of calibration found");
      }

      // Check for near-expiry batch/serial inventory
      // Alert at 14, 7, 3, and 1 day(s) before expiration to avoid repeated daily spam
      console.log("Checking for near-expiry tracked entities...");
      try {
        const todayMs = new Date().setHours(0, 0, 0, 0);
        const alertThresholds = [14, 7, 3, 1];

        // Build date range: entities expiring within the next 14 days (furthest threshold)
        const maxThreshold = Math.max(...alertThresholds);
        const maxDate = new Date(todayMs + maxThreshold * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        const todayStr = new Date(todayMs).toISOString().split("T")[0];

        const nearExpiryEntities = await serviceRole
          .from("trackedEntity")
          .select(
            "id, readableId, sourceDocumentReadableId, expirationDate, companyId"
          )
          .eq("status", "Available")
          .not("expirationDate", "is", null)
          .gte("expirationDate", todayStr)
          .lte("expirationDate", maxDate);

        if (nearExpiryEntities.error) {
          console.error(
            `Error fetching near-expiry entities: ${JSON.stringify(nearExpiryEntities.error)}`
          );
        } else if (nearExpiryEntities.data.length > 0) {
          console.log(
            `Found ${nearExpiryEntities.data.length} entities with expiration dates in the next ${maxThreshold} days`
          );

          // Get unique company IDs from the near-expiry entities
          const companyIds = [
            ...new Set(
              nearExpiryEntities.data
                .map((e) => e.companyId)
                .filter((id): id is string => id !== null)
            )
          ];

          const companySettingsResult = await serviceRole
            .from("companySettings")
            .select("id, shelfLifeExpiryNotificationGroup")
            .in("id", companyIds);

          if (companySettingsResult.error) {
            console.error(
              `Error fetching company settings for shelf life alerts: ${JSON.stringify(companySettingsResult.error)}`
            );
          } else {
            const notificationGroupByCompany = new Map(
              companySettingsResult.data.map((s) => [
                s.id,
                // @ts-ignore - column added in shelf-life migration
                (s.shelfLifeExpiryNotificationGroup as string[]) ?? []
              ])
            );

            const shelfLifeNotificationPayloads: TriggerPayload[] = [];

            for (const entity of nearExpiryEntities.data) {
              if (!entity.companyId || !entity.expirationDate) continue;

              const [ey, em, ed] = (entity.expirationDate as string)
                .split("-")
                .map(Number);
              const expMs = Date.UTC(ey, em - 1, ed);
              const remainingDays = Math.floor(
                (expMs - todayMs) / (1000 * 60 * 60 * 24)
              );

              // Only alert on specific threshold days to avoid daily repetition
              if (!alertThresholds.includes(remainingDays)) continue;

              const notificationGroup =
                notificationGroupByCompany.get(entity.companyId) ?? [];

              if (notificationGroup.length === 0) {
                console.log(
                  `No shelf life expiry notification group configured for company ${entity.companyId}, skipping entity ${entity.id}`
                );
                continue;
              }

              const description = `Batch "${entity.readableId ?? entity.id}" of ${entity.sourceDocumentReadableId ?? "item"} expires on ${entity.expirationDate} (${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining)`;

              for (const userId of notificationGroup) {
                shelfLifeNotificationPayloads.push({
                  workflow: NotificationWorkflow.Expiration,
                  payload: {
                    event: NotificationEvent.ShelfLifeExpiring,
                    recordId: entity.id,
                    description
                  },
                  user: {
                    subscriberId: getSubscriberId({
                      companyId: entity.companyId,
                      userId
                    })
                  }
                });
              }
            }

            if (shelfLifeNotificationPayloads.length > 0) {
              console.log(
                `Triggering ${shelfLifeNotificationPayloads.length} near-expiry shelf life notifications`
              );
              try {
                await triggerBulk(novu, shelfLifeNotificationPayloads);
                console.log(
                  `Successfully triggered ${shelfLifeNotificationPayloads.length} shelf life expiry notifications`
                );
              } catch (error) {
                console.error(
                  "Error triggering shelf life expiry notifications"
                );
                console.error(error);
              }
            } else {
              console.log(
                "No shelf life expiry notifications to trigger (no entities at threshold days or no groups configured)"
              );
            }
          }
        } else {
          console.log("No near-expiry entities found");
        }
      } catch (shelfLifeError) {
        console.error(
          "Error in shelf life expiry check:",
          shelfLifeError instanceof Error
            ? shelfLifeError.message
            : String(shelfLifeError)
        );
        // Non-fatal: continue cleanup
      }

      console.log(`Cleanup tasks completed: ${new Date().toISOString()}`);
    });
  }
);
