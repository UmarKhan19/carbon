import { requirePermissions } from "@carbon/auth/auth.server";
import { CalendarDate, endOfMonth, parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";

type PaymentTermCalculationMethod = "Net" | "End of Month" | "Day of Month";

/**
 * Calculates the due date based on payment term settings
 */
function calculateDueDate(
  dateIssued: string,
  daysDue: number,
  calculationMethod: PaymentTermCalculationMethod
): string {
  const issuedDate = parseDate(dateIssued);

  switch (calculationMethod) {
    case "Net":
      return issuedDate.add({ days: daysDue }).toString();
    case "End of Month": {
      const monthEnd = endOfMonth(issuedDate);
      return monthEnd.add({ days: daysDue }).toString();
    }
    case "Day of Month": {
      const nextMonth = issuedDate.add({ months: 1 });
      const targetDay = Math.min(daysDue, endOfMonth(nextMonth).day);
      return new CalendarDate(
        nextMonth.year,
        nextMonth.month,
        targetDay
      ).toString();
    }
    default:
      return issuedDate.add({ days: daysDue }).toString();
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "invoiceCustomerId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          const currency = await getCurrencyByCode(
            client,
            companyId,
            currencyCode
          );
          return await client
            .from("salesInvoice")
            .update({
              invoiceCustomerId: value ?? undefined,
              invoiceCustomerContactId: null,
              invoiceCustomerLocationId: null,
              currencyCode: currencyCode ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesInvoice")
        .update({
          customerId: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "dateIssued":
      if (ids.length === 1 && value) {
        // First fetch the invoice to get its paymentTermId
        const invoice = await client
          .from("salesInvoice")
          .select("paymentTermId")
          .eq("id", ids[0] as string)
          .single();

        if (invoice.data?.paymentTermId) {
          // Fetch the payment term using the invoice's paymentTermId
          const paymentTermResult = await client
            .from("paymentTerm")
            .select("*")
            .eq("id", invoice.data.paymentTermId)
            .single();

          if (paymentTermResult.data) {
            const dateDue = calculateDueDate(
              value as string,
              paymentTermResult.data.daysDue,
              paymentTermResult.data.calculationMethod as PaymentTermCalculationMethod
            );
            return await client
              .from("salesInvoice")
              .update({
                dateIssued: value,
                dateDue,
                updatedBy: userId,
                updatedAt: new Date().toISOString()
              })
              .eq("id", ids[0] as string);
          }
        }
        // No payment term set, just update dateIssued without dateDue
        return await client
          .from("salesInvoice")
          .update({
            dateIssued: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", ids[0] as string);
      }
      break;
    // don't break -- just let it catch the next case
    case "currencyCode":
      if (value) {
        const currency = await getCurrencyByCode(
          client,
          companyId,
          value as string
        );
        if (currency.data) {
          return await client
            .from("salesInvoice")
            .update({
              currencyCode: value as string,
              exchangeRate: currency.data.exchangeRate ?? 1,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .in("id", ids as string[]);
        }
      }
    // don't break -- just let it catch the next case
    case "paymentTermId":
      if (ids.length === 1 && value) {
        // When payment term changes, recalculate dateDue if dateIssued exists
        const [invoiceForPaymentTerm, newPaymentTerm] = await Promise.all([
          client
            .from("salesInvoice")
            .select("dateIssued")
            .eq("id", ids[0] as string)
            .single(),
          client
            .from("paymentTerm")
            .select("*")
            .eq("id", value as string)
            .single()
        ]);

        if (invoiceForPaymentTerm.data?.dateIssued && newPaymentTerm.data) {
          const newDateDue = calculateDueDate(
            invoiceForPaymentTerm.data.dateIssued,
            newPaymentTerm.data.daysDue,
            newPaymentTerm.data.calculationMethod as PaymentTermCalculationMethod
          );
          return await client
            .from("salesInvoice")
            .update({
              paymentTermId: value,
              dateDue: newDateDue,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .eq("id", ids[0] as string);
        }
      }
      // Fall through to generic update if no dateIssued or payment term not found
    case "customerId":
    case "invoiceCustomerContactId":
    case "invoiceCustomerLocationId":
    case "locationId":
    case "customerReference":
    case "exchangeRate":
    case "dateDue":
    case "datePaid":
      return await client
        .from("salesInvoice")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
