import { z } from "zod";
import { zfd } from "zod-form-data";

export const paymentType = ["Receipt", "Disbursement"] as const;
export const paymentStatus = ["Draft", "Posted", "Voided"] as const;

export type PaymentType = (typeof paymentType)[number];
export type PaymentStatusType = (typeof paymentStatus)[number];

export function isPaymentLocked(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const paymentValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    paymentId: zfd.text(z.string().optional()),
    paymentType: z.enum(paymentType, {
      errorMap: () => ({ message: "Payment type is required" })
    }),
    customerId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    paymentDate: z.string().min(1, { message: "Payment date is required" }),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    exchangeRate: zfd.numeric(z.number().positive().default(1)),
    totalAmount: zfd.numeric(
      z.number().positive({ message: "Total amount must be > 0" })
    ),
    bankAccount: z.string().min(1, { message: "Bank account is required" }),
    reference: zfd.text(z.string().optional()),
    memo: zfd.text(z.string().optional())
  })
  .refine(
    (d) =>
      d.paymentType === "Receipt"
        ? Boolean(d.customerId)
        : Boolean(d.supplierId),
    {
      message: "Receipt requires a customer; Disbursement requires a supplier",
      path: ["customerId"]
    }
  );

export const paymentApplicationValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    paymentId: z.string().min(1, { message: "Payment is required" }),
    salesInvoiceId: zfd.text(z.string().optional()),
    purchaseInvoiceId: zfd.text(z.string().optional()),
    appliedAmount: zfd.numeric(z.number().nonnegative().default(0)),
    discountAmount: zfd.numeric(z.number().nonnegative().default(0)),
    writeOffAmount: zfd.numeric(z.number().nonnegative().default(0)),
    invoiceExchangeRate: zfd.numeric(
      z.number().positive({ message: "Invoice exchange rate must be > 0" })
    ),
    paymentExchangeRate: zfd.numeric(
      z.number().positive({ message: "Payment exchange rate must be > 0" })
    ),
    appliedDate: z.string().min(1, { message: "Applied date is required" })
  })
  .refine((d) => Boolean(d.salesInvoiceId) !== Boolean(d.purchaseInvoiceId), {
    message: "Application must target exactly one invoice (sales OR purchase)",
    path: ["salesInvoiceId"]
  })
  .refine(
    (d) =>
      Number(d.appliedAmount) +
        Number(d.discountAmount) +
        Number(d.writeOffAmount) >
      0,
    {
      message: "At least one of applied / discount / write-off must be > 0",
      path: ["appliedAmount"]
    }
  );

export const paymentPostValidator = z.object({
  id: z.string().min(1)
});
