import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Heading,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate, PERIOD_CLOSE_STATUS_COLOR_MAP } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData } from "react-router";
import { Empty } from "~/components";
import { getAccountingPeriods } from "~/modules/accounting";
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

  return { periods: periods.data ?? [] };
}

export default function AccountingPeriodsRoute() {
  const { periods } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex px-4 py-3 items-center justify-between bg-card border-b border-border w-full">
        <Heading size="h3">
          <Trans>Accounting Periods</Trans>
        </Heading>
      </div>

      {periods.length === 0 ? (
        <Empty>
          <Trans>No accounting periods yet</Trans>
        </Empty>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Period</Trans>
              </Th>
              <Th>
                <Trans>Date Range</Trans>
              </Th>
              <Th>
                <Trans>Status</Trans>
              </Th>
              <Th>
                <Trans>Close Status</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Actions</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {periods.map((period) => {
              const label =
                period.fiscalYear && period.periodNumber
                  ? `FY${period.fiscalYear} · Period ${period.periodNumber}`
                  : formatDate(period.startDate);
              const closeColor =
                PERIOD_CLOSE_STATUS_COLOR_MAP[period.closeStatus] ?? "gray";

              return (
                <Tr key={period.id}>
                  <Td className="font-medium">{label}</Td>
                  <Td>
                    {formatDate(period.startDate)} –{" "}
                    {formatDate(period.endDate)}
                  </Td>
                  <Td>{period.status}</Td>
                  <Td>
                    <Status color={closeColor}>{period.closeStatus}</Status>
                  </Td>
                  <Td className="text-right">
                    <Button asChild variant="secondary" size="sm">
                      <Link to={path.to.accountingPeriodClose(period.id)}>
                        {period.closeStatus === "Closed" ? (
                          <Trans>View</Trans>
                        ) : (
                          <Trans>Close</Trans>
                        )}
                      </Link>
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}

      <Outlet />
    </VStack>
  );
}
