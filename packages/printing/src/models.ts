import { z } from "zod";
import { zfd } from "zod-form-data";

export const printerRouteValidator = z.object({
  id: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  format: z.enum(["zpl", "pdf"]),
  mediaSizeId: z.string().min(1, { message: "Media size is required" }),
  printerUrl: z.string().url({ message: "Must be a valid URL" }),
  apiKey: zfd.text(z.string().optional()),
  templateId: zfd.text(z.string().optional())
});

export const updateAssignmentValidator = z.object({
  locationId: z.string().min(1),
  context: z.enum(["default", "shipping", "receiving", "workCenter"]),
  contextId: zfd.text(z.string().optional()),
  printerRouteId: zfd.text(z.string().optional()),
  autoPrint: zfd.checkbox()
});

export const reprintValidator = z.object({
  printJobId: z.string().min(1, { message: "Print job ID is required" }),
  printerUrl: zfd.text(z.string().optional())
});
