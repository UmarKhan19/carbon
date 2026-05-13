import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import { msg } from "@lingui/core/macro";
import type { FileObject } from "@supabase/storage-js";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  redirect,
  useLoaderData,
  useParams,
  useSubmit
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getCurrencyByCode } from "~/modules/accounting";
import { getSupplierPriceBreaksForItems } from "~/modules/items";
import type { SalesOrderLine } from "~/modules/sales";
import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments,
  getQuote,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuoteMethodTrees,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrderLines
} from "~/modules/sales";
import {
  QuoteExplorer,
  QuoteHeader,
  QuoteProperties
} from "~/modules/sales/ui/Quotes";
import { useOptimisticDocumentDrag } from "~/modules/sales/ui/Quotes/QuoteExplorer";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Quotes`,
  module: "sales",
  to: path.to.quotes
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      bypassRls: true,
      view: "sales"
    }
  );

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const quote = await getQuote(client, quoteId);

  if (quote.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  if (companyId !== quote.data?.companyId) {
    throw redirect(path.to.quotes);
  }

  const [
    customer,
    shipment,
    payment,
    lines,
    prices,
    opportunity,
    methods,
    opportunityDocuments,
    companySettings
  ] = await Promise.all([
    getCustomer(client, quote.data?.customerId ?? ""),
    getQuoteShipment(client, quoteId),
    getQuotePayment(client, quoteId),
    getQuoteLines(client, quoteId),
    getQuoteLinePricesByQuoteId(client, quoteId),
    getOpportunity(client, quote.data?.opportunityId),
    getQuoteMethodTrees(client, quoteId),
    getOpportunityDocuments(client, companyId, quote.data?.opportunityId ?? ""),
    getCompanySettings(client, companyId)
  ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (companyId !== quote.data?.companyId) {
    throw redirect(path.to.quotes);
  }

  if (shipment.error) {
    throw redirect(
      path.to.quotes,
      await flash(
        request,
        error(shipment.error, "Failed to load quote shipment")
      )
    );
  }

  if (payment.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(payment.error, "Failed to load quote payment"))
    );
  }

  let exchangeRate = 1;
  if (quote.data?.currencyCode) {
    const presentationCurrency = await getCurrencyByCode(
      client,
      companyGroupId,
      quote.data.currencyCode
    );
    if (presentationCurrency.data?.exchangeRate) {
      exchangeRate = presentationCurrency.data.exchangeRate;
    }
  }

  let salesOrderLines: PostgrestResponse<SalesOrderLine> | null = null;
  if (
    opportunity.data?.salesOrders.length &&
    opportunity.data.salesOrders[0]?.id
  ) {
    salesOrderLines = await getSalesOrderLines(
      client,
      opportunity.data.salesOrders[0]?.id
    );
  }

  const defaultCc =
    // @ts-expect-error TS18048 - TODO: fix type
    customer.data?.defaultCc?.length > 0
      ? // @ts-expect-error TS18047 - TODO: fix type
        customer.data.defaultCc
      : (companySettings.data?.defaultCustomerCc ?? []);

  // Collect all Buy item IDs from method trees + top-level Buy lines
  const methodTrees = methods.data ?? [];
  const buyItemIds = new Set<string>();
  function collectBuyItems(tree: (typeof methodTrees)[number]) {
    if (tree.data.methodType === "Purchase to Order" && tree.data.itemId) {
      buyItemIds.add(tree.data.itemId);
    }
    tree.children?.forEach(collectBuyItems);
  }
  methodTrees.forEach(collectBuyItems);
  // Also include top-level Buy lines (non-Make lines)
  for (const line of lines.data ?? []) {
    if (line.methodType === "Purchase to Order" && line.itemId) {
      buyItemIds.add(line.itemId);
    }
  }

  const supplierPriceMap = await getSupplierPriceBreaksForItems(
    client,
    Array.from(buyItemIds)
  );

  return {
    customer: customer.data,
    defaultCc,
    exchangeRate,
    files: opportunityDocuments,
    lines: lines.data ?? [],
    methods: methodTrees,
    opportunity: opportunity.data,
    payment: payment.data,
    prices: prices.data ?? [],
    quote: quote.data,
    salesOrderLines: salesOrderLines?.data ?? null,
    shipment: shipment.data,
    supplierPriceMap
  };
}

export default function QuoteRoute() {
  const params = useParams();
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  const { methods } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const pendingItems = useOptimisticDocumentDrag();

  const handleDrop = (
    document: FileObject & { path: string },
    targetId: string
  ) => {
    if (
      pendingItems.find((item: any) => item.itemId === `pending-${document.id}`)
    )
      return;

    const formData = new FormData();
    const payload = {
      id: document.id,
      lineId: targetId.startsWith("quote-line-")
        ? targetId.replace("quote-line-", "")
        : undefined,
      name: document.name,
      path: document.path,
      size: document.metadata?.size || 0
    };

    formData.append("payload", JSON.stringify(payload));

    submit(formData, {
      action: path.to.quoteDrag(quoteId),
      fetcherKey: `quote-drag:${document.name}`,
      method: "post",
      navigate: false
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (over && active.data.current?.type === "opportunityDocument") {
      handleDrop(
        active.data.current as unknown as FileObject & { path: string },
        over.id as string
      );
    }
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <PanelProvider key={quoteId}>
        <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full ">
          <QuoteHeader />
          <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
            <div className="flex flex-grow overflow-hidden">
              <ResizablePanels
                explorer={<QuoteExplorer methods={methods} />}
                content={
                  <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                    <VStack spacing={2} className="p-2">
                      <Outlet />
                    </VStack>
                  </div>
                }
                properties={<QuoteProperties key={quoteId} />}
              />
            </div>
          </div>
        </div>
      </PanelProvider>
    </DndContext>
  );
}
