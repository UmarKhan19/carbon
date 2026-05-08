// Notification event taxonomy. Kept as a standalone package because the
// enums are referenced from app routes, scheduled jobs, and the inngest
// notify function. The previous Novu trigger helpers have been removed —
// callers now dispatch a `carbon/notify` event via @carbon/lib's `trigger()`
// and the notify function handles fan-out (in-app / email / slack).

export enum NotificationEvent {
  ApprovalApproved = "approval-approved",
  Digest = "digest",
  ApprovalRejected = "approval-rejected",
  ApprovalRequested = "approval-requested",
  DigitalQuoteResponse = "digital-quote-response",
  GaugeCalibrationExpired = "gauge-calibration-expired",
  JobAssignment = "job-assignment",
  JobCompleted = "job-completed",
  JobOperationAssignment = "job-operation-assignment",
  JobOperationMessage = "job-operation-message",
  MaintenanceDispatchAssignment = "maintenance-dispatch-assignment",
  MaintenanceDispatchCreated = "maintenance-dispatch-created",
  NonConformanceAssignment = "issue-assignment",
  ProcedureAssignment = "procedure-assignment",
  PurchaseInvoiceAssignment = "purchase-invoice-assignment",
  PurchaseOrderAssignment = "purchase-order-assignment",
  QuoteAssignment = "quote-assignment",
  QuoteExpired = "quote-expired",
  RiskAssignment = "risk-assignment",
  SalesOrderAssignment = "sales-order-assignment",
  SalesRfqAssignment = "sales-rfq-assignment",
  SalesRfqReady = "sales-rfq-ready",
  StockTransferAssignment = "stock-transfer-assignment",
  SuggestionResponse = "suggestion-response",
  SupplierQuoteAssignment = "supplier-quote-assignment",
  SupplierQuoteResponse = "supplier-quote-response",
  TrainingAssignment = "training-assignment"
}

// Coarse buckets used for digest grouping. Each event maps to exactly one
// topic via getNotificationTopic. The string values are persisted in the
// `notification.topic` column, so renaming any of these is a migration.
export enum NotificationTopic {
  Approval = "approval",
  General = "general",
  Inventory = "inventory",
  Job = "job",
  Maintenance = "maintenance",
  Purchasing = "purchasing",
  Quality = "quality",
  Quote = "quote",
  Sales = "sales",
  Suggestion = "suggestion",
  Training = "training"
}

// Fan-out targets understood by the notify Inngest function. inApp is
// always included regardless of what the caller passes — the topbar reflects
// every notification. email and slack are opt-in extras.
export enum NotificationDestination {
  InApp = "inApp",
  Email = "email",
  Slack = "slack"
}

export function getNotificationTopic(
  event: NotificationEvent
): NotificationTopic {
  switch (event) {
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage:
    case NotificationEvent.JobCompleted:
      return NotificationTopic.Job;
    case NotificationEvent.PurchaseInvoiceAssignment:
    case NotificationEvent.PurchaseOrderAssignment:
      return NotificationTopic.Purchasing;
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
    case NotificationEvent.DigitalQuoteResponse:
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return NotificationTopic.Quote;
    case NotificationEvent.SalesOrderAssignment:
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return NotificationTopic.Sales;
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
    case NotificationEvent.GaugeCalibrationExpired:
      return NotificationTopic.Maintenance;
    case NotificationEvent.NonConformanceAssignment:
    case NotificationEvent.RiskAssignment:
      return NotificationTopic.Quality;
    case NotificationEvent.ProcedureAssignment:
    case NotificationEvent.TrainingAssignment:
      return NotificationTopic.Training;
    case NotificationEvent.StockTransferAssignment:
      return NotificationTopic.Inventory;
    case NotificationEvent.SuggestionResponse:
      return NotificationTopic.Suggestion;
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      return NotificationTopic.Approval;
    case NotificationEvent.Digest:
    default:
      return NotificationTopic.General;
  }
}

type ApprovalDocumentType = "purchaseOrder" | "qualityDocument";

const x = "x";
// Path templates for ERP records that notifications can deep-link to. These
// mirror apps/erp/app/utils/path.ts — kept here (not imported from the app)
// because @carbon/notifications is upstream of the apps in the dependency
// graph. If a route changes in path.ts, update the matching builder here.
export const notificationPath = {
  gauge: (id: string) => `/${x}/quality/gauges/${id}`,
  job: (id: string) => `/${x}/job/${id}`,
  jobOperation: (jobId: string, operationId: string) =>
    `/${x}/job/methods/${jobId}/operation/${operationId}`,
  maintenanceDispatch: (id: string) => `/${x}/maintenance/${id}`,
  nonConformance: (id: string) => `/${x}/issue/${id}`,
  procedure: (id: string) => `/${x}/procedure/${id}`,
  purchaseInvoice: (id: string) => `/${x}/purchase-invoice/${id}`,
  purchaseOrder: (id: string) => `/${x}/purchase-order/${id}`,
  qualityDocument: (id: string) => `/${x}/quality-document/${id}`,
  quote: (id: string) => `/${x}/quote/${id}`,
  risk: (id: string) => `/${x}/quality/risks/${id}`,
  salesOrder: (id: string) => `/${x}/sales-order/${id}`,
  salesRfq: (id: string) => `/${x}/sales-rfq/${id}`,
  stockTransfer: (id: string) => `/${x}/stock-transfer/${id}`,
  suggestion: (id: string) => `/${x}/resources/suggestions/${id}`,
  supplierQuote: (id: string) => `/${x}/supplier-quote/${id}`,
  training: (id: string) => `/${x}/training/${id}`
} as const;

// Relative path that the notification deep-links to in the ERP app. Used for
// email CTA buttons and (in future) topbar click handlers. Returns null if
// the event doesn't correspond to a single navigable record.
export function getNotificationLink(
  event: NotificationEvent,
  recordId: string,
  documentType?: ApprovalDocumentType
): string | null {
  switch (event) {
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobCompleted:
      return notificationPath.job(recordId);
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [jobId, operationId] = recordId.split(":");
      if (!jobId || !operationId) return null;
      return notificationPath.jobOperation(jobId, operationId);
    }
    case NotificationEvent.PurchaseInvoiceAssignment:
      return notificationPath.purchaseInvoice(recordId);
    case NotificationEvent.PurchaseOrderAssignment:
      return notificationPath.purchaseOrder(recordId);
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
    case NotificationEvent.DigitalQuoteResponse:
      return notificationPath.quote(recordId);
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return notificationPath.supplierQuote(recordId);
    case NotificationEvent.SalesOrderAssignment:
      return notificationPath.salesOrder(recordId);
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return notificationPath.salesRfq(recordId);
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
      return notificationPath.maintenanceDispatch(recordId);
    case NotificationEvent.GaugeCalibrationExpired:
      return notificationPath.gauge(recordId);
    case NotificationEvent.NonConformanceAssignment:
      return notificationPath.nonConformance(recordId);
    case NotificationEvent.RiskAssignment:
      return notificationPath.risk(recordId);
    case NotificationEvent.ProcedureAssignment:
      return notificationPath.procedure(recordId);
    case NotificationEvent.TrainingAssignment:
      return notificationPath.training(recordId);
    case NotificationEvent.StockTransferAssignment:
      return notificationPath.stockTransfer(recordId);
    case NotificationEvent.SuggestionResponse:
      return notificationPath.suggestion(recordId);
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      if (documentType === "purchaseOrder") {
        return notificationPath.purchaseOrder(recordId);
      }
      if (documentType === "qualityDocument") {
        return notificationPath.qualityDocument(recordId);
      }
      return null;
    case NotificationEvent.Digest:
    default:
      return null;
  }
}

// Short, human-readable subject line used for the email per event. The body
// of the email is the full description; the subject is a category label so
// users can scan their inbox quickly.
export function getNotificationEmailSubject(event: NotificationEvent): string {
  switch (event) {
    case NotificationEvent.JobAssignment:
      return "Job assigned to you";
    case NotificationEvent.JobCompleted:
      return "Job completed";
    case NotificationEvent.JobOperationAssignment:
      return "Job operation assigned to you";
    case NotificationEvent.JobOperationMessage:
      return "New job operation message";
    case NotificationEvent.PurchaseInvoiceAssignment:
      return "Purchase invoice assigned to you";
    case NotificationEvent.PurchaseOrderAssignment:
      return "Purchase order assigned to you";
    case NotificationEvent.QuoteAssignment:
      return "Quote assigned to you";
    case NotificationEvent.QuoteExpired:
      return "Quote expired";
    case NotificationEvent.DigitalQuoteResponse:
      return "Digital quote response";
    case NotificationEvent.SupplierQuoteAssignment:
      return "Supplier quote assigned to you";
    case NotificationEvent.SupplierQuoteResponse:
      return "Supplier quote response";
    case NotificationEvent.SalesOrderAssignment:
      return "Sales order assigned to you";
    case NotificationEvent.SalesRfqAssignment:
      return "RFQ assigned to you";
    case NotificationEvent.SalesRfqReady:
      return "RFQ ready for quote";
    case NotificationEvent.MaintenanceDispatchAssignment:
      return "Maintenance dispatch assigned to you";
    case NotificationEvent.MaintenanceDispatchCreated:
      return "New maintenance dispatch";
    case NotificationEvent.GaugeCalibrationExpired:
      return "Gauge calibration expired";
    case NotificationEvent.NonConformanceAssignment:
      return "Issue assigned to you";
    case NotificationEvent.RiskAssignment:
      return "Risk assigned to you";
    case NotificationEvent.ProcedureAssignment:
      return "Procedure assigned to you";
    case NotificationEvent.TrainingAssignment:
      return "Training assigned to you";
    case NotificationEvent.StockTransferAssignment:
      return "Stock transfer assigned to you";
    case NotificationEvent.SuggestionResponse:
      return "New suggestion submitted";
    case NotificationEvent.ApprovalRequested:
      return "Approval requested";
    case NotificationEvent.ApprovalApproved:
      return "Your request was approved";
    case NotificationEvent.ApprovalRejected:
      return "Your request was rejected";
    case NotificationEvent.Digest:
    default:
      return "You have a new notification";
  }
}

// Action label shown on the email's CTA button. Falls back to "View" when no
// link is available. Tone matches the subject — short, imperative.
export function getNotificationEmailCtaLabel(event: NotificationEvent): string {
  switch (event) {
    case NotificationEvent.ApprovalRequested:
      return "Review approval";
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
      return "View decision";
    case NotificationEvent.JobCompleted:
      return "View job";
    case NotificationEvent.SuggestionResponse:
      return "View suggestion";
    case NotificationEvent.GaugeCalibrationExpired:
      return "View gauge";
    case NotificationEvent.QuoteExpired:
      return "View quote";
    case NotificationEvent.DigitalQuoteResponse:
    case NotificationEvent.SupplierQuoteResponse:
      return "View response";
    default:
      return "View details";
  }
}

// English phrase used as the digest row's title. Persisted in
// `notification.title`, so changing the wording does not require a migration
// but does change what existing digest rows display on next render.
//
// Not currently localized — same limitation as the per-event description in
// the notify function. Future i18n work should move both into the topbar
// renderer and store stable identifiers in the row instead.
export function getNotificationTopicPhrase(
  topic: NotificationTopic,
  count: number
): string {
  const plural = count === 1 ? "notification" : "notifications";
  switch (topic) {
    case NotificationTopic.Job:
      return `${count} job ${plural}`;
    case NotificationTopic.Purchasing:
      return `${count} purchasing ${plural}`;
    case NotificationTopic.Quote:
      return `${count} quote ${plural}`;
    case NotificationTopic.Sales:
      return `${count} sales ${plural}`;
    case NotificationTopic.Maintenance:
      return `${count} maintenance ${plural}`;
    case NotificationTopic.Quality:
      return `${count} quality ${plural}`;
    case NotificationTopic.Training:
      return `${count} training ${plural}`;
    case NotificationTopic.Inventory:
      return `${count} inventory ${plural}`;
    case NotificationTopic.Suggestion:
      return `${count} suggestion ${plural}`;
    case NotificationTopic.Approval:
      return `${count} approval ${plural}`;
    case NotificationTopic.General:
    default:
      return `${count} unread ${plural}`;
  }
}
