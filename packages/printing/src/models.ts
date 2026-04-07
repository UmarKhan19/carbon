import { z } from "zod";
import { zfd } from "zod-form-data";
import { documentTypeRegistry } from "./registry";

export const autoPrintSettingsValidator = z.object({
  receiptLabels: zfd.checkbox(),
  shipmentLabels: zfd.checkbox(),
  kanbanCards: zfd.checkbox(),
  operationLabels: zfd.checkbox()
});

export const printerRouteValidator = z.object({
  id: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  format: z.enum(["zpl", "pdf"]),
  mediaSizeId: zfd.text(z.string().optional()),
  printerUrl: z.string().url({ message: "Must be a valid URL" }),
  apiKey: zfd.text(z.string().optional())
});

function buildAssignmentSchema() {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const dt of documentTypeRegistry) {
    shape[`${dt.id}_printerRouteId`] = zfd.text(z.string().optional());
    shape[`${dt.id}_templateId`] = zfd.text(z.string().optional());
  }
  return z.object(shape);
}

export const assignmentSettingsValidator = buildAssignmentSchema();

export const locationOverrideValidator = z.object({
  locationId: z.string().min(1, { message: "Location is required" }),
  documentType: z.string().min(1, { message: "Document type is required" }),
  printerRouteId: z.string().min(1, { message: "Printer is required" })
});

export const workCenterOverrideValidator = z.object({
  workCenterId: z.string().min(1, { message: "Work center is required" }),
  documentType: z.string().min(1, { message: "Document type is required" }),
  printerRouteId: z.string().min(1, { message: "Printer is required" })
});

export const reprintValidator = z.object({
  printJobId: z.string().min(1, { message: "Print job ID is required" }),
  printerUrl: zfd.text(z.string().url().optional())
});
