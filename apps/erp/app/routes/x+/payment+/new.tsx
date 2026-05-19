import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { Heading, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { Form, redirect } from "react-router";
import { paymentValidator, upsertPayment } from "~/modules/invoicing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(paymentValidator).validate(formData);
  if (validation.error) {
    return validation.error;
  }

  const nextSequence = await getNextSequence(client, "payment", companyId);
  if (nextSequence.error || !nextSequence.data) {
    return flash(
      request,
      error(nextSequence.error, "Failed to allocate payment id")
    );
  }

  const payment = await upsertPayment(client, {
    ...validation.data,
    paymentId: nextSequence.data,
    companyId,
    createdBy: userId
  });
  if (payment.error || !payment.data) {
    throw redirect(
      path.to.payments,
      await flash(request, error(payment.error, "Failed to create payment"))
    );
  }

  throw redirect(
    path.to.payment(payment.data.id),
    await flash(request, success("Payment created"))
  );
}

export default function NewPaymentRoute() {
  // Minimal create form. Detail page is where you actually fill in
  // applications and then post. Required-only fields here.
  return (
    <VStack spacing={4} className="p-6 max-w-2xl">
      <Heading size="h2">
        <Trans>New Payment</Trans>
      </Heading>
      <Form method="post" className="flex flex-col gap-4 w-full">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Type</span>
          <select
            name="paymentType"
            className="border border-border rounded px-2 py-1"
            required
          >
            <option value="Receipt">Receipt (AR)</option>
            <option value="Disbursement">Disbursement (AP)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Customer ID (if Receipt)</span>
          <input
            name="customerId"
            className="border border-border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Supplier ID (if Disbursement)
          </span>
          <input
            name="supplierId"
            className="border border-border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Payment Date</span>
          <input
            name="paymentDate"
            type="date"
            className="border border-border rounded px-2 py-1"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Currency Code</span>
          <input
            name="currencyCode"
            defaultValue="USD"
            className="border border-border rounded px-2 py-1"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Exchange Rate (vs base)</span>
          <input
            name="exchangeRate"
            type="number"
            step="0.00000001"
            defaultValue="1"
            className="border border-border rounded px-2 py-1"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Total Amount</span>
          <input
            name="totalAmount"
            type="number"
            step="0.01"
            min="0.01"
            className="border border-border rounded px-2 py-1"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Bank Account ID</span>
          <input
            name="bankAccount"
            className="border border-border rounded px-2 py-1"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Reference</span>
          <input
            name="reference"
            className="border border-border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Memo</span>
          <textarea
            name="memo"
            rows={2}
            className="border border-border rounded px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded px-4 py-2 hover:opacity-90 self-start"
        >
          <Trans>Create Payment</Trans>
        </button>
      </Form>
    </VStack>
  );
}
