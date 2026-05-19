import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  PaymentForm,
  paymentValidator,
  upsertPayment
} from "~/modules/invoicing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const validation = await validator(paymentValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  // Use the provided paymentId if set (SequenceOrCustomId may return a
  // custom one); otherwise pull from the sequence.
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

  throw redirect(
    path.to.payment(insert.data.id),
    await flash(request, success("Payment created"))
  );
}

export default function NewPaymentRoute() {
  const today = new Date().toISOString().slice(0, 10);
  const initialValues = {
    paymentId: "",
    paymentType: "Receipt" as const,
    customerId: "",
    supplierId: "",
    paymentDate: today,
    currencyCode: "",
    exchangeRate: 1,
    totalAmount: 0,
    bankAccount: "",
    reference: "",
    memo: ""
  };
  return <PaymentForm initialValues={initialValues} />;
}
