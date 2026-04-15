import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { resolvePriceList } from "~/modules/sales/pricing";

const headers = ["Part ID", "Description", "Unit Price"];

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const customerTypeId = url.searchParams.get("customerTypeId");

  if (!customerId && !customerTypeId) {
    return new Response(headers.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=price-list.csv",
      },
    });
  }

  let filename = "price-list";

  if (customerId) {
    const { data: customer } = await client
      .from("customer")
      .select("name")
      .eq("id", customerId)
      .single();

    filename = `price-list-${customer?.name?.replace(/[^a-zA-Z0-9]/g, "-") ?? "customer"}`;
  } else if (customerTypeId) {
    const { data: customerType } = await client
      .from("customerType")
      .select("name")
      .eq("id", customerTypeId)
      .single();

    filename = `price-list-${customerType?.name?.replace(/[^a-zA-Z0-9]/g, "-") ?? "type"}`;
  }

  const result = await resolvePriceList(client, companyId, {
    customerId: customerId ?? undefined,
    customerTypeId: customerTypeId ?? undefined,
    limit: 10000,
    offset: 0,
    sorts: [],
    filters: [],
  });

  let csv = headers.join(",") + "\n";

  for (const row of result.data) {
    csv +=
      [
        row.partId,
        `"${row.itemName.replace(/"/g, '""')}"`,
        row.resolvedPrice.toFixed(2),
      ].join(",") + "\n";
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=${filename}.csv`,
    },
  });
}
