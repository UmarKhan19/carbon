import { z } from "zod";
import { zfd } from "zod-form-data";

export const clockInValidator = z.object({
  intent: z.literal("clockIn"),
  employeeId: zfd.text(z.string().optional())
});

export const clockOutValidator = z.object({
  intent: z.literal("clockOut"),
  employeeId: zfd.text(z.string().optional()),
  note: zfd.text(z.string().optional()),
  type: zfd.text(z.enum(["shift_end", "break"]).optional())
});

export const updateTimeClockEntryValidator = z.object({
  intent: z.literal("updateEntry"),
  entryId: z.string().min(1),
  clockIn: z.string().min(1),
  clockOut: zfd.text(z.string().optional()),
  note: zfd.text(z.string().optional())
});

export const deleteTimeClockEntryValidator = z.object({
  intent: z.literal("deleteEntry"),
  entryId: z.string().min(1)
});
