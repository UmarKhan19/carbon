// Re-export the inngest client and helpers
export { inngest } from "./client.ts";

import {
  auditFunction,
  embeddingFunction,
  eventQueueFunction,
  searchFunction,
  syncFunction,
  webhookFunction,
  workflowFunction
} from "./functions/events";
import {
  accountingBackfillFunction,
  jiraSyncFunction,
  linearSyncFunction,
  paperlessPartsFunction,
  slackDocumentAssignmentUpdateFunction,
  slackDocumentCreatedFunction,
  slackDocumentStatusUpdateFunction,
  slackDocumentTaskUpdateFunction,
  syncExternalAccountingFunction,
  timeCardAutoCloseFunction
} from "./functions/integrations";
// Import all functions
import { notifyFunction, sendEmailFunction } from "./functions/notifications";
import {
  auditArchiveFunction,
  cleanupFunction,
  dispatchFunction,
  mrpFunction,
  updateExchangeRatesFunction,
  weeklyFunction
} from "./functions/scheduled";
import {
  modelThumbnailFunction,
  onboardFunction,
  postTransactionFunction,
  recalculateFunction,
  rescheduleJobFunction,
  updatePermissionsFunction,
  userAdminFunction
} from "./functions/tasks";

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
  embeddingFunction,
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
  slackDocumentAssignmentUpdateFunction,
  timeCardAutoCloseFunction
];
