import type { Database } from "@carbon/database";

// Notification event taxonomy. Kept as a standalone package because the
// enums are referenced from app routes, scheduled jobs, and the inngest
// notify function. The previous Novu trigger helpers have been removed —
// callers now dispatch a `carbon/notify` event via @carbon/lib's `trigger()`
// and the notify function handles fan-out (in-app / email / slack).

export enum NotificationEvent {
  ApprovalApproved = "approval-approved",
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

// Coarse topic buckets. Each event maps to exactly one topic via
// getNotificationTopic. The string values are persisted in the
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
  Email = "email"
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
    default:
      return NotificationTopic.General;
  }
}

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

const x = "x";
// Path templates for ERP records that notifications can deep-link to. These
// mirror apps/erp/app/utils/path.ts — kept here (not imported from the app)
// because @carbon/notifications is upstream of the apps in the dependency
// graph. If a route changes in path.ts, update the matching builder here.
export const notificationPath = {
  gauge: (id: string) => `/${x}/quality/gauges/${id}`,
  job: (id: string) => `/${x}/job/${id}/details`,
  jobOperation: (
    jobId: string,
    makeMethodId: string,
    operationId: string,
    materialId?: string
  ) => {
    const base = materialId
      ? `/${x}/job/${jobId}/make/${makeMethodId}`
      : `/${x}/job/${jobId}/method/${makeMethodId}`;
    return `${base}?selectedOperation=${operationId}`;
  },
  maintenanceDispatch: (id: string) => `/${x}/maintenance/${id}`,
  nonConformance: (id: string) => `/${x}/issue/${id}`,
  procedure: (id: string) => `/${x}/procedure/${id}`,
  purchaseInvoice: (id: string) => `/${x}/purchase-invoice/${id}/details`,
  purchaseOrder: (id: string) => `/${x}/purchase-order/${id}/details`,
  qualityDocument: (id: string) => `/${x}/quality-document/${id}`,
  quote: (id: string) => `/${x}/quote/${id}/details`,
  risk: (id: string) => `/${x}/quality/risks/${id}`,
  salesOrder: (id: string) => `/${x}/sales-order/${id}/details`,
  salesRfq: (id: string) => `/${x}/sales-rfq/${id}`,
  stockTransfer: (id: string) => `/${x}/stock-transfer/${id}`,
  suggestion: (id: string) => `/${x}/resources/suggestions/${id}`,
  supplierApproval: (id: string) => `/${x}/supplier/${id}/approval`,
  supplierQuote: (id: string) => `/${x}/supplier-quote/${id}/details`,
  training: (id: string) => `/share/training/${id}`
} as const;

// Relative path that the notification deep-links to in the ERP app. Used for
// email CTA buttons and (in future) topbar click handlers. Returns null if
// the event doesn't correspond to a single navigable record.
export type NotificationLinkContext = {
  documentType?: ApprovalDocumentType;
  jobId?: string;
  operationId?: string;
  makeMethodId?: string;
  materialId?: string;
};

export function getNotificationLink(
  event: NotificationEvent,
  recordId: string,
  context?: NotificationLinkContext
): string | null {
  switch (event) {
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobCompleted:
      return notificationPath.job(recordId);
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const { jobId, operationId, makeMethodId, materialId } = context ?? {};
      if (!jobId || !operationId || !makeMethodId) return null;
      return notificationPath.jobOperation(
        jobId,
        makeMethodId,
        operationId,
        materialId
      );
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
      if (context?.documentType === "purchaseOrder") {
        return notificationPath.purchaseOrder(recordId);
      }
      if (context?.documentType === "qualityDocument") {
        return notificationPath.qualityDocument(recordId);
      }
      if (context?.documentType === "supplier") {
        return notificationPath.supplierApproval(recordId);
      }
      return null;
    default:
      return null;
  }
}

// Generic category label rendered as the in-email heading (sits under the
// "New notification" eyebrow). The inbox subject is the per-event description
// so users can scan their inbox; this gives the email body a stable category
// title regardless of the record specifics in the description.
export function getNotificationEmailHeading(event: NotificationEvent): string {
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
    default:
      return "You have a new notification";
  }
}

// Action label shown on the email's CTA button. Falls back to "View" when no
// link is available. Tone matches the heading — short, imperative.
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
