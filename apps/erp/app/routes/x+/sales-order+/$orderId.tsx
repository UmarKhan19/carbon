import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments,
  getQuote,
  getSalesOrder,
  getSalesOrderLines,
  getSalesOrderRelatedItems
} from "~/modules/sales";
import {
  SalesOrderExplorer,
  SalesOrderHeader,
  SalesOrderProperties
} from "~/modules/sales/ui/SalesOrder";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.salesOrders,
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [salesOrder, lines] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderLines(client, orderId)
  ]);

  const opportunity = await getOpportunity(
    client,
    salesOrder.data?.opportunityId ?? null
  );

  if (companyId !== salesOrder.data?.companyId) {
    throw redirect(path.to.salesOrders);
  }

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  const serviceRole = getCarbonServiceRole();
  const [quote, customer, companySettings] = await Promise.all([
    opportunity.data.quotes[0]?.id
      ? getQuote(client, opportunity.data.quotes[0].id)
      : Promise.resolve(null),
    salesOrder.data?.customerId
      ? getCustomer(client, salesOrder.data.customerId)
      : Promise.resolve(null),
    getCompanySettings(serviceRole, companyId)
  ]);

  const defaultCc = customer?.data?.defaultCc?.length
    ? customer.data.defaultCc
    : (companySettings.data?.defaultCustomerCc ?? []);

  return {
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: getOpportunityDocuments(client, companyId, opportunity.data.id),
    relatedItems: getSalesOrderRelatedItems(
      client,
      orderId,
      opportunity.data.id
    ),
    opportunity: opportunity.data,
    customer: customer?.data ?? null,
    quote: quote?.data ?? null,
    originatedFromQuote: !!opportunity.data.quotes[0]?.id,
    defaultCc
  };
}

export default function SalesOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <SalesOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SalesOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<SalesOrderProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
