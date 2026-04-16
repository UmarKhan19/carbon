import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { stepRecordValidator } from "~/services/models";
import {
  getJobOperationStepForCompany,
  insertAttributeRecord
} from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requireActiveEmployee(request);

  const formData = await request.formData();
  const validation = await validator(stepRecordValidator).validate(formData);
  const serviceRole = await getCarbonServiceRole();

  if (validation.error) {
    return validationError(validation.error);
  }

  const authorizedStep = await getJobOperationStepForCompany(
    serviceRole,
    validation.data.jobOperationStepId,
    companyId
  );

  if (authorizedStep.error || !authorizedStep.data) {
    return data(
      {},
      await flash(request, error(authorizedStep.error, "Access Denied"))
    );
  }

  const attributeRecord = await insertAttributeRecord(serviceRole, {
    ...validation.data,
    jobOperationStepId: authorizedStep.data.id,
    companyId,
    createdBy: userId
  });

  if (attributeRecord.error) {
    return data(
      {},
      await flash(
        request,
        error(attributeRecord.error, "Failed to record attribute")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Attribute recorded successfully"))
  );
}
