// Re-export the inngest client and helpers
export { inngest, sendEvent, sendEvents } from "./client";

// Import all functions
import { notifyFunction, sendEmailFunction } from "./functions/notifications";
import {
  auditFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction
} from "./functions/events";
import {
  modelThumbnailFunction,
  updatePermissionsFunction,
  recalculateFunction,
  userAdminFunction,
  postTransactionFunction,
  rescheduleJobFunction,
  onboardFunction
} from "./functions/tasks";
import {
  cleanupFunction,
  dispatchFunction,
  auditArchiveFunction,
  mrpFunction,
  weeklyFunction,
  updateExchangeRatesFunction
} from "./functions/scheduled";
import {
  jiraSyncFunction,
  linearSyncFunction,
  paperlessPartsFunction,
  accountingBackfillFunction,
  syncExternalAccountingFunction,
  slackDocumentCreatedFunction,
  slackDocumentStatusUpdateFunction,
  slackDocumentTaskUpdateFunction,
  slackDocumentAssignmentUpdateFunction
} from "./functions/integrations";

// Export all functions for serving via serve() or connect()
export const functions = [
  // Notifications
  notifyFunction,
  sendEmailFunction,
  // Event handlers
  auditFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction,
  // Tasks
  modelThumbnailFunction,
  updatePermissionsFunction,
  recalculateFunction,
  userAdminFunction,
  postTransactionFunction,
  rescheduleJobFunction,
  onboardFunction,
  // Scheduled
  cleanupFunction,
  dispatchFunction,
  auditArchiveFunction,
  mrpFunction,
  weeklyFunction,
  updateExchangeRatesFunction,
  // Integrations
  jiraSyncFunction,
  linearSyncFunction,
  paperlessPartsFunction,
  accountingBackfillFunction,
  syncExternalAccountingFunction,
  slackDocumentCreatedFunction,
  slackDocumentStatusUpdateFunction,
  slackDocumentTaskUpdateFunction,
  slackDocumentAssignmentUpdateFunction
];

// Worker utilities
export { connect } from "inngest/connect";
export { detectMode, startWorker, type InngestMode } from "./worker";

/**
 * Create a connect worker with the Carbon inngest client and functions.
 *
 * @example
 * ```ts
 * import { createWorker } from "@carbon/jobs/inngest";
 *
 * // Start worker with default options
 * await createWorker();
 *
 * // Or with custom options
 * await createWorker({
 *   maxWorkerConcurrency: 20,
 *   instanceId: "my-worker-1",
 * });
 * ```
 */
export async function createWorker(options?: {
  maxWorkerConcurrency?: number;
  instanceId?: string;
  appVersion?: string;
  handleShutdownSignals?: NodeJS.Signals[];
}) {
  const { connect } = await import("inngest/connect");
  const { inngest } = await import("./client");

  return connect({
    apps: [{ client: inngest, functions }],
    appVersion: options?.appVersion || process.env.APP_VERSION,
    instanceId: options?.instanceId || `worker-${process.pid}`,
    maxWorkerConcurrency: options?.maxWorkerConcurrency || 10,
    handleShutdownSignals: options?.handleShutdownSignals || [
      "SIGTERM",
      "SIGINT"
    ]
  });
}
