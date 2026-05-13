import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { isSalesOrderLocked } from "~/modules/sales";
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

  // Check if any of the selected orders are locked
  const salesOrders = await client
    .from("salesOrder")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    checkFn: isSalesOrderLocked,
    message: "Cannot modify a confirmed sales order.",
    statuses: (salesOrders.data ?? []).map((o) => o.status)
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "customerId":
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
            .from("salesOrder")
            .update({
              currencyCode: currencyCode ?? undefined,
              customerId: value ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("salesOrder")
        .update({
          customerId: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "currencyCode":
      if (value) {
        const currency = await getCurrencyByCode(
          client,
          companyGroupId,
          value as string
        );
        if (currency.data) {
          return await client
            .from("salesOrder")
            .update({
              currencyCode: value as string,
              exchangeRate: currency.data.exchangeRate,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }
    // don't break -- just let it catch the next case
    case "customerContactId":
    case "customerEngineeringContactId":
    case "customerLocationId":
    case "customerReference":

    case "exchangeRate":
    case "expirationDate":
    case "locationId":
    case "orderDate":
    case "salesPersonId":
      return await client
        .from("salesOrder")
        .update({
          [field]: value ? value : null,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "receiptPromisedDate":
    case "receiptRequestedDate":
      return await client
        .from("salesOrderShipment")
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
