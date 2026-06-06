import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { NotificationEvent } from "@carbon/notifications";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

function resolve(
  event: NotificationEvent,
  documentId: string,
  documentType?: ApprovalDocumentType
): string | null {
  switch (event) {
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobCompleted:
      return path.to.job(documentId);
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [jobId, operationId, makeMethodId, materialId] =
        documentId.split(":");
      if (!jobId || !operationId || !makeMethodId) return null;
      const link = materialId
        ? path.to.jobMakeMethod(jobId, makeMethodId)
        : path.to.jobMethod(jobId, makeMethodId);
      return `${link}?selectedOperation=${operationId}`;
    }
    case NotificationEvent.PurchaseInvoiceAssignment:
      return path.to.purchaseInvoice(documentId);
    case NotificationEvent.PurchaseOrderAssignment:
      return path.to.purchaseOrder(documentId);
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
    case NotificationEvent.DigitalQuoteResponse:
      return path.to.quote(documentId);
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return path.to.supplierQuote(documentId);
    case NotificationEvent.SalesOrderAssignment:
      return path.to.salesOrder(documentId);
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return path.to.salesRfq(documentId);
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
      return path.to.maintenanceDispatch(documentId);
    case NotificationEvent.GaugeCalibrationExpired:
      return path.to.gauge(documentId);
    case NotificationEvent.NonConformanceAssignment:
      return path.to.issue(documentId);
    case NotificationEvent.RiskAssignment:
      return path.to.risk(documentId);
    case NotificationEvent.ProcedureAssignment:
      return path.to.procedure(documentId);
    case NotificationEvent.TrainingAssignment:
      return path.to.training(documentId);
    case NotificationEvent.StockTransferAssignment:
      return path.to.stockTransfer(documentId);
    case NotificationEvent.SuggestionResponse:
      return path.to.suggestion(documentId);
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      if (documentType === "purchaseOrder")
        return path.to.purchaseOrder(documentId);
      if (documentType === "qualityDocument")
        return path.to.qualityDocument(documentId);
      if (documentType === "supplier")
        return path.to.supplierApproval(documentId);
      return null;
    default:
      return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const url = new URL(request.url);
  const event = url.searchParams.get("event") as NotificationEvent | null;
  const documentId = url.searchParams.get("documentId");
  const documentType = url.searchParams.get(
    "documentType"
  ) as ApprovalDocumentType | null;

  if (!event || !documentId) {
    throw redirect(path.to.authenticatedRoot);
  }

  const link = resolve(event, documentId, documentType ?? undefined);
  throw redirect(link ?? path.to.authenticatedRoot);
}
