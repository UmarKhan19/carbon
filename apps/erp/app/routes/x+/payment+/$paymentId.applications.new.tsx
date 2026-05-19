import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  paymentApplicationValidator,
  upsertPaymentApplication
} from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const { paymentId } = params;
  if (!paymentId) throw redirect(path.to.payments);

  const formData = await request.formData();
  // Hidden field is already in the form, but enforce it server-side.
  formData.set("paymentId", paymentId);

  const validation = await validator(paymentApplicationValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertPaymentApplication(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(insert.error, "Failed to add application"))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Application added"))
  );
}
