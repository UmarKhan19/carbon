import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { isPurchaseOrderLocked } from "~/modules/purchasing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string") {
    return { data: null, error: { message: "Invalid form data" } };
  }

  if (field === "delete") {
    return await client
      .from("purchaseOrder")
      .delete()
      .in("id", ids as string[]);
  }

  // Check if any of the POs are locked except for deliveryDate
  if (field !== "deliveryDate") {
    const purchaseOrders = await client
      .from("purchaseOrder")
      .select("status")
      .in("id", ids as string[]);
    const lockedError = requireUnlockedBulk({
      checkFn: isPurchaseOrderLocked,
      message: "Cannot modify a confirmed purchase order.",
      statuses: (purchaseOrders.data ?? []).map((d) => d.status)
    });
    if (lockedError) {
      return lockedError;
    }
  }

  if (typeof value !== "string" && value !== null) {
    return { data: null, error: { message: "Invalid form data" } };
  }

  switch (field) {
    case "supplierId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const supplier = await client
          ?.from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (supplier.data?.currencyCode) {
          currencyCode = supplier.data.currencyCode;
          const currency = await getCurrencyByCode(
            client,
            companyGroupId,
            currencyCode
          );
          return await client
            .from("purchaseOrder")
            .update({
              currencyCode: currencyCode ?? undefined,
              exchangeRate: currency.data?.exchangeRate ?? 1,
              supplierId: value ?? undefined,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("purchaseOrder")
        .update({
          supplierId: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "receiptRequestedDate":
    case "locationId":
    case "deliveryDate":
      return await client
        .from("purchaseOrderDelivery")
        .update({
          [field]: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "receiptPromisedDate":
      const lineUpdates = await client
        .from("purchaseOrderLine")
        .update({
          promisedDate: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("purchaseOrderId", ids as string[])
        .is("promisedDate", null);

      if (lineUpdates.error) {
        return lineUpdates;
      }

      return await client
        .from("purchaseOrderDelivery")
        .update({
          [field]: value ?? undefined,
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
            .from("purchaseOrder")
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
    case "supplierContactId":
    case "supplierLocationId":
    case "supplierReference":
    case "exchangeRate":
    case "orderDate":
      return await client
        .from("purchaseOrder")
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
