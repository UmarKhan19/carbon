import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getAccountingPeriods } from "~/modules/accounting";
import { PeriodsTable } from "~/modules/accounting/ui/Periods";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Accounting Periods`,
  to: path.to.accountingPeriods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const periods = await getAccountingPeriods(client, companyId);
  if (periods.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(periods.error, "Failed to load accounting periods")
      )
    );
  }

  return { periods: periods.data ?? [], count: periods.count ?? 0 };
}

export default function AccountingPeriodsRoute() {
  const { periods, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PeriodsTable data={periods} count={count} />
      <Outlet />
    </VStack>
  );
}
