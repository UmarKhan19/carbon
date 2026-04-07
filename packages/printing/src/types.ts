export type TemplateAssignment = {
  printerRouteId: string | null;
  templateId: string | null; // null = built-in, string = BinderyPress template ID
};

export type PrintingSettings = {
  autoPrint: {
    receiptLabels: boolean;
    shipmentLabels: boolean;
    kanbanCards: boolean;
    operationLabels: boolean;
  } | null;
  assignments: Record<string, TemplateAssignment | null> | null;
  locationOverrides: Record<string, Record<string, string>> | null;
  workCenterOverrides: Record<string, Record<string, string>> | null;
};

export type PrinterRoute = {
  id: string;
  companyId: string;
  locationId: string | null;
  name: string;
  format: "zpl" | "pdf";
  mediaSizeId: string | null;
  printerUrl: string;
  apiKey: string | null;
};

export type PrintJobStatus =
  | "generating"
  | "queued"
  | "printing"
  | "completed"
  | "failed";
export type PrintJobOrigin = "auto" | "manual" | "reprint";
export type PrintJobContentType = "zpl" | "pdf";

export type PrintJob = {
  id: string;
  companyId: string;
  status: PrintJobStatus;
  contentType: PrintJobContentType | null;
  content: string | null;
  printerUrl: string;
  sourceDocument: string;
  sourceDocumentId: string;
  sourceDocumentReadableId: string | null;
  description: string;
  origin: PrintJobOrigin;
  error: string | null;
  attempts: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
  completedAt: string | null;
};
