import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { finishValidator } from "~/services/models";
import {
  finishJobOperation,
  getJobOperationForCompany
} from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requireActiveEmployee(request);

  const formData = await request.formData();
  const validation = await validator(finishValidator).validate(formData);
  const serviceRole = await getCarbonServiceRole();

  if (validation.error) {
    return validationError(validation.error);
  }

  const authorizedOperation = await getJobOperationForCompany(
    serviceRole,
    validation.data.jobOperationId,
    companyId
  );

  if (authorizedOperation.error || !authorizedOperation.data) {
    return data(
      {},
      await flash(request, error(authorizedOperation.error, "Access Denied"))
    );
  }

  const finishOperation = await finishJobOperation(serviceRole, {
    ...validation.data,
    jobOperationId: authorizedOperation.data.id,
    userId
  });

  if (finishOperation.error) {
    return data(
      {},
      await flash(
        request,
        error(finishOperation.error, "Failed to finish operation")
      )
    );
  }

  throw redirect(
    path.to.operations,
    await flash(request, success("Operation finished successfully"))
  );
}
