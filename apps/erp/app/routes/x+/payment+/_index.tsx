import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getPayments, PaymentsTable } from "~/modules/invoicing";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const paymentType = searchParams.get("paymentType") as
    | "Receipt"
    | "Disbursement"
    | null;
  const status = searchParams.get("status") as
    | "Draft"
    | "Posted"
    | "Voided"
    | null;
  const customerId = searchParams.get("customerId");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const payments = await getPayments(client, companyId, {
    search,
    paymentType,
    status,
    customerId,
    supplierId,
    limit,
    offset,
    sorts,
    filters
  });

  if (payments.error) {
    throw redirect(
      path.to.payments,
      await flash(request, error(payments.error, "Failed to fetch payments"))
    );
  }

  return {
    count: payments.count ?? 0,
    payments: payments.data ?? []
  };
}

export default function PaymentsIndexRoute() {
  const { count, payments } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <PaymentsTable data={payments} count={count} />
      <Outlet />
    </VStack>
  );
}
