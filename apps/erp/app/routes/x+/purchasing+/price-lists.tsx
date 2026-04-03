import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getPriceLists, updatePriceListSequence } from "~/modules/pricing";
import { PriceListsTable } from "~/modules/pricing/ui/PriceLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Price Lists",
  to: path.to.purchasePriceLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // Extract supplierId from filters (it's on priceListAssignment, not priceList)
  const supplierIdFilter = filters?.find((f) => f.column === "supplierId");
  const supplierId = supplierIdFilter?.value ?? undefined;

  return await getPriceLists(client, companyId, "Purchase", {
    search: search ?? undefined,
    supplierId,
    limit,
    offset,
    sorts,
    filters
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reorder") {
    const updates = JSON.parse(formData.get("updates") as string) as Record<
      string,
      number
    >;

    for (const [id, sequence] of Object.entries(updates)) {
      await updatePriceListSequence(client, id, sequence, userId);
    }
  }

  return null;
}

export default function PurchasePriceListsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PriceListsTable data={data ?? []} count={count ?? 0} type="Purchase" />
      <Outlet />
    </VStack>
  );
}
