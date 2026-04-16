import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { nonScrapQuantityValidator } from "~/services/models";
import {
  getJobOperationForCompany,
  insertReworkQuantity
} from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requireActiveEmployee(request);

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const authorizedOperation = await getJobOperationForCompany(
    client,
    validation.data.jobOperationId,
    companyId
  );

  if (authorizedOperation.error || !authorizedOperation.data) {
    return data(
      {},
      await flash(request, error(authorizedOperation.error, "Access Denied"))
    );
  }

  const insertRework = await insertReworkQuantity(client, {
    ...validation.data,
    jobOperationId: authorizedOperation.data.id,
    companyId,
    createdBy: userId
  });

  if (insertRework.error) {
    return data(
      {},
      await flash(
        request,
        error(insertRework.error, "Failed to record rework quantity")
      )
    );
  }

  return data(
    insertRework.data,
    await flash(request, success("Rework quantity recorded successfully"))
  );
}
