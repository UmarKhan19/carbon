import { assertIsPost, error } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { issueValidator } from "~/services/models";
import {
  getItemForCompany,
  getJobMaterialForOperation,
  getJobOperationForCompany
} from "~/services/operations.service";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requireActiveEmployee(request);

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return data({ error: validation.error }, { status: 400 });
  }

  const { jobOperationId, materialId, itemId, quantity, adjustmentType } =
    validation.data;

  const serviceRole = await getCarbonServiceRole();
  const authorizedOperation = await getJobOperationForCompany(
    serviceRole,
    jobOperationId,
    companyId
  );

  if (authorizedOperation.error || !authorizedOperation.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(authorizedOperation.error, "Access Denied"))
    );
  }

  const [authorizedItem, authorizedMaterial] = await Promise.all([
    getItemForCompany(serviceRole, itemId, companyId),
    materialId
      ? getJobMaterialForOperation(
          serviceRole,
          materialId,
          authorizedOperation.data.id,
          companyId
        )
      : Promise.resolve({ data: null, error: null })
  ]);

  if (authorizedItem.error || !authorizedItem.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(authorizedItem.error, "Access Denied"))
    );
  }

  if (materialId && (authorizedMaterial.error || !authorizedMaterial.data)) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(authorizedMaterial.error, "Access Denied"))
    );
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      id: authorizedOperation.data.id,
      type: "partToOperation",
      itemId: authorizedItem.data.id,
      materialId: authorizedMaterial.data?.id,
      quantity,
      adjustmentType,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (issue.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(issue.error, "Failed to issue material"))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.operations);
}
