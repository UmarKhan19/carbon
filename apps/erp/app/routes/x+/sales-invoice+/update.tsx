import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { isSalesInvoiceLocked } from "~/modules/invoicing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
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
    return { data: null, error: { message: "Invalid form data" } };
  }

  // Check if any of the SIs are locked
  const salesInvoices = await client
    .from("salesInvoice")
    .select("status")
    .in("id", ids as string[]);
  const dateFields = ["dateIssued", "dateDue", "datePaid"];
  if (!dateFields.includes(field)) {
    const lockedError = requireUnlockedBulk({
      checkFn: isSalesInvoiceLocked,
      message: "Cannot modify a locked sales invoice.",
      statuses: (salesInvoices.data ?? []).map((si) => si.status)
    });
    if (lockedError) return lockedError;
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
            companyGroupId,
            currencyCode
          );
          return await client
            .from("salesInvoice")
            .update({
              currencyCode: currencyCode ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
              invoiceCustomerContactId: null,
              invoiceCustomerId: value ?? undefined,
              invoiceCustomerLocationId: null,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesInvoice")
        .update({
          customerId: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "dateIssued":
      if (ids.length === 1) {
        const paymentTerms = await client
          .from("paymentTerm")
          .select("*")
          .eq("id", value as string)
          .single();
        if (paymentTerms.data) {
          return await client
            .from("salesInvoice")
            .update({
              dateDue: parseDate(value as string)
                .add({ days: paymentTerms.data.daysDue })
                .toString(),
              dateIssued: value,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .eq("id", ids[0] as string);
        } else {
          return await client
            .from("salesInvoice")
            .update({
              [field]: value ? value : null,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }
      break;
    // don't break -- just let it catch the next case
    case "currencyCode":
      if (value) {
        const currency = await getCurrencyByCode(
          client,
          companyGroupId,
          value as string
        );
        if (currency.data) {
          return await client
            .from("salesInvoice")
            .update({
              currencyCode: value as string,
              exchangeRate: currency.data.exchangeRate ?? 1,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }
    // don't break -- just let it catch the next case
    case "customerId":
    case "invoiceCustomerContactId":
    case "invoiceCustomerLocationId":
    case "locationId":
    case "customerReference":
    case "paymentTermId":
    case "exchangeRate":
    case "dateDue":
    case "datePaid":
      return await client
        .from("salesInvoice")
        .update({
          [field]: value ? value : null,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);

    default:
      return { data: null, error: { message: "Invalid field" } };
  }
}
