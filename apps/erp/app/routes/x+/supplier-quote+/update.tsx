import { requirePermissions } from "@carbon/auth/auth.server";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { isSupplierQuoteLocked } from "~/modules/purchasing";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "purchasing"
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

  // Per-ID locked check
  const quotes = await client
    .from("supplierQuote")
    .select("status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    checkFn: isSupplierQuoteLocked,
    message: "Cannot modify a locked supplier quote. Reopen it first.",
    statuses: (quotes.data ?? []).map((q) => q.status)
  });
  if (lockedError) return lockedError;

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
          return await client
            .from("supplierQuote")
            .update({
              currencyCode: currencyCode ? currencyCode : undefined,
              supplierId: value ?? undefined,
              updatedAt: new Date().toISOString(),
              updatedBy: userId
            })
            .in("id", ids as string[]);
        }
      }

      return await client
        .from("supplierQuote")
        .update({
          supplierId: value ?? undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    case "currencyCode":
      const currency = await getCurrencyByCode(
        client,
        companyGroupId,
        value as string
      );
      if (currency.data) {
        return await client
          .from("supplierQuote")
          .update({
            currencyCode: value,
            exchangeRate: currency.data.exchangeRate,
            updatedAt: new Date().toISOString(),
            updatedBy: userId
          })
          .in("id", ids as string[]);
      }
    // don't break -- just let it catch the next case

    case "supplierContactId":
    case "supplierLocationId":
    case "supplierReference":
    case "quotedDate":
      return await client
        .from("supplierQuote")
        .update({
          [field]: value ? value : null,
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);

    case "expirationDate":
      return await client
        .from("supplierQuote")
        .update({
          expirationDate: value ? value : null,
          status: value
            ? today(getLocalTimeZone()).toString() > value
              ? "Expired"
              : "Active"
            : "Active",
          updatedAt: new Date().toISOString(),
          updatedBy: userId
        })
        .in("id", ids as string[]);
    default:
      return { data: null, error: { message: "Invalid field" } };
  }
}
