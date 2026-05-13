import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import {
  getSupplierQuote,
  isSupplierQuoteLocked,
  supplierQuoteValidator,
  upsertSupplierQuote
} from "~/modules/purchasing";
import type {
  SupplierInteraction,
  SupplierQuote
} from "~/modules/purchasing/types";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import SupplierInteractionState from "~/modules/purchasing/ui/SupplierInteraction/SupplierInteractionState";
import SupplierQuoteSummary from "~/modules/purchasing/ui/SupplierQuote/SupplierQuoteSummary";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const quote = await getSupplierQuote(client, id);
  if (quote.error) {
    throw redirect(
      path.to.supplierQuotes,
      await flash(request, error(quote.error, "Failed to load supplier quote"))
    );
  }

  return {
    externalNotes: (quote.data?.externalNotes ?? {}) as JSONContent,
    internalNotes: (quote.data?.internalNotes ?? {}) as JSONContent
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(viewClient, id);
  await requireUnlocked({
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    message: "Cannot modify a locked supplier quote. Reopen it first.",
    redirectTo: path.to.supplierQuote(id),
    request
  });

  const formData = await request.formData();
  const validation = await validator(supplierQuoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { supplierQuoteId, ...d } = validation.data;
  if (!supplierQuoteId) throw new Error("Could not find supplierQuoteId");

  const update = await upsertSupplierQuote(client, {
    id,
    supplierQuoteId,
    ...d,
    companyGroupId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(update.error, "Failed to update quote"))
    );
  }

  throw redirect(
    path.to.supplierQuote(id),
    await flash(request, success("Updated quote"))
  );
}

export default function SupplierQuoteDetailsRoute() {
  const { internalNotes, externalNotes } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    quote: SupplierQuote;
    files: Promise<(FileObject & { quoteLineId: string | null })[]>;
    interaction: SupplierInteraction & {
      purchasingRfq?: { id: string; rfqId: string; status: string } | null;
    };
    siblingQuotes: {
      id: string;
      supplierQuoteId?: string;
      revisionId?: number;
      status?: string;
      supplierId?: string;
      supplier?: { name: string } | null;
    }[];
  }>(path.to.supplierQuote(id));

  if (!routeData) throw new Error("Could not find quote data");
  const initialValues = {
    currencyCode: routeData?.quote?.currencyCode ?? undefined,
    exchangeRate: routeData?.quote?.exchangeRate ?? undefined,
    exchangeRateUpdatedAt: routeData?.quote?.exchangeRateUpdatedAt ?? "",
    expirationDate: routeData?.quote?.expirationDate ?? "",
    id: routeData?.quote?.id ?? "",
    quotedDate: routeData?.quote?.quotedDate ?? "",
    status: routeData?.quote?.status ?? "Active",
    supplierContactId: routeData?.quote?.supplierContactId ?? "",
    supplierId: routeData?.quote?.supplierId ?? "",
    supplierLocationId: routeData?.quote?.supplierLocationId ?? "",
    supplierQuoteId: routeData?.quote?.supplierQuoteId ?? "",
    supplierReference: routeData?.quote?.supplierReference ?? ""
  };

  return (
    <>
      <SupplierInteractionState
        interaction={routeData.interaction}
        siblingQuotes={routeData.siblingQuotes ?? []}
      />
      <SupplierQuoteSummary />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={routeData.quote.id}
        title="Notes"
        table="supplierQuote"
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <DeferredFiles key={`documents-${id}`} resolve={routeData.files}>
        {(resolvedFiles) => (
          <SupplierInteractionDocuments
            interactionId={routeData.interaction.id}
            attachments={resolvedFiles}
            id={id}
            type="Supplier Quote"
          />
        )}
      </DeferredFiles>
    </>
  );
}
