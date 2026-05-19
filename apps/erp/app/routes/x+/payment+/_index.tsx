import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Heading, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { New } from "~/components";
import { getPayments } from "~/modules/invoicing";
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
    <VStack spacing={4} className="h-full p-6">
      <HStack className="justify-between w-full">
        <Heading size="h2">
          <Trans>Payments</Trans>{" "}
          <span className="text-muted-foreground">({count})</span>
        </Heading>
        <New label="Payment" to={path.to.paymentNew} />
      </HStack>
      <div className="w-full rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase">
            <tr>
              <th className="text-left p-3">ID</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Counterparty</th>
              <th className="text-left p-3">Date</th>
              <th className="text-right p-3">Total</th>
              <th className="text-left p-3">Currency</th>
              <th className="text-left p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  <Trans>No payments yet.</Trans>
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border hover:bg-muted/20"
                >
                  <td className="p-3">
                    <Link
                      to={path.to.payment(p.id)}
                      className="text-primary hover:underline"
                    >
                      {p.paymentId}
                    </Link>
                  </td>
                  <td className="p-3">{p.paymentType}</td>
                  <td className="p-3">{p.customerId ?? p.supplierId ?? "—"}</td>
                  <td className="p-3">{p.paymentDate}</td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(p.totalAmount).toFixed(2)}
                  </td>
                  <td className="p-3">{p.currencyCode}</td>
                  <td className="p-3">{p.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Outlet />
    </VStack>
  );
}
