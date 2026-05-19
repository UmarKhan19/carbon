import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getPurchaseInvoice,
  getSalesInvoice,
  PaymentForm,
  paymentValidator,
  upsertPayment,
  upsertPaymentApplication
} from "~/modules/invoicing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

// Loader pre-fills the form when navigated from an invoice header.
// Query params:
//   customerId  -> seeds counterparty + paymentType=Receipt
//   supplierId  -> seeds counterparty + paymentType=Disbursement
//   invoiceId   -> looked up to seed currency / exchangeRate; on submit,
//                  the action will auto-create a first application
//   amount      -> seeds totalAmount (typically the invoice balance)
export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    create: "invoicing"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const supplierId = url.searchParams.get("supplierId");
  const invoiceId = url.searchParams.get("invoiceId");
  const amount = url.searchParams.get("amount");

  const paymentType: "Receipt" | "Disbursement" = supplierId
    ? "Disbursement"
    : "Receipt";

  let currencyCode = "";
  let exchangeRate = 1;

  if (invoiceId) {
    if (paymentType === "Receipt") {
      const inv = await getSalesInvoice(client, invoiceId);
      if (inv.data) {
        currencyCode = inv.data.currencyCode ?? "";
        exchangeRate = Number(inv.data.exchangeRate ?? 1);
      }
    } else {
      const inv = await getPurchaseInvoice(client, invoiceId);
      if (inv.data) {
        currencyCode = inv.data.currencyCode ?? "";
        exchangeRate = Number(inv.data.exchangeRate ?? 1);
      }
    }
  }

  return {
    initialValues: {
      paymentId: "",
      paymentType,
      customerId: customerId ?? "",
      supplierId: supplierId ?? "",
      paymentDate: new Date().toISOString().slice(0, 10),
      currencyCode,
      exchangeRate,
      totalAmount: amount ? Number(amount) : 0,
      bankAccount: "",
      reference: "",
      memo: ""
    },
    seedInvoiceId: invoiceId,
    seedInvoiceExchangeRate: exchangeRate
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  // The form passes these via hidden inputs (set by the loader) so the
  // action can build a starter application without re-reading the URL.
  const seedInvoiceId = formData.get("seedInvoiceId");
  const seedInvoiceExchangeRate = formData.get("seedInvoiceExchangeRate");

  const validation = await validator(paymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  let paymentId = validation.data.paymentId;
  if (!paymentId) {
    const next = await getNextSequence(client, "payment", companyId);
    if (next.error || !next.data) {
      throw redirect(
        path.to.payments,
        await flash(request, error(next.error, "Failed to allocate payment id"))
      );
    }
    paymentId = next.data;
  }

  const insert = await upsertPayment(client, {
    ...validation.data,
    paymentId,
    companyId,
    createdBy: userId
  });
  if (insert.error || !insert.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(insert.error, "Failed to create payment"))
    );
  }

  // NetSuite-style starter application: when navigating from an invoice,
  // auto-create a single application against it for the full requested
  // amount. User can still adjust via the apply table on the detail page.
  if (typeof seedInvoiceId === "string" && seedInvoiceId.length > 0) {
    const isReceipt = validation.data.paymentType === "Receipt";
    const invRate = Number(seedInvoiceExchangeRate) || 1;
    await upsertPaymentApplication(client, {
      paymentId: insert.data.id,
      salesInvoiceId: isReceipt ? seedInvoiceId : undefined,
      purchaseInvoiceId: isReceipt ? undefined : seedInvoiceId,
      appliedAmount: Number(validation.data.totalAmount),
      discountAmount: 0,
      writeOffAmount: 0,
      invoiceExchangeRate: invRate,
      paymentExchangeRate: Number(validation.data.exchangeRate) || 1,
      appliedDate: validation.data.paymentDate,
      companyId,
      createdBy: userId
    });
  }

  throw redirect(
    path.to.payment(insert.data.id),
    await flash(request, success("Payment created"))
  );
}

export default function NewPaymentRoute() {
  const { initialValues, seedInvoiceId, seedInvoiceExchangeRate } =
    useLoaderData<typeof loader>();
  return (
    <PaymentForm
      initialValues={initialValues}
      seedInvoiceId={seedInvoiceId ?? undefined}
      seedInvoiceExchangeRate={seedInvoiceExchangeRate ?? undefined}
    />
  );
}
