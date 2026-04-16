import { assertIsPost } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { convertEntityValidator } from "~/services/models";
import { getTrackedEntityForCompany } from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requireActiveEmployee(request);

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const newRevision = formData.get("newRevision");
  const quantity = formData.get("quantity");

  const validation = convertEntityValidator.safeParse({
    trackedEntityId: id,
    newRevision,
    quantity
  });

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const {
    trackedEntityId,
    newRevision: revision,
    quantity: newQuantity
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const trackedEntity = await getTrackedEntityForCompany(
    serviceRole,
    trackedEntityId,
    companyId
  );

  if (trackedEntity.error || !trackedEntity.data) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  const convert = await serviceRole.functions.invoke("issue", {
    body: {
      type: "convertEntity",
      trackedEntityId: trackedEntity.data.id,
      newRevision: revision,
      quantity: newQuantity,
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (convert.error) {
    console.error(convert.error);
    return data(
      { success: false, message: "Failed to convert entity" },
      { status: 400 }
    );
  }

  const converted = convert.data as {
    success: boolean;
    message: string;
    convertedEntity?: {
      trackedEntityId: string;
      readableId: string;
      quantity: number;
    };
  };

  return {
    success: true,
    message: "Entity converted successfully",
    convertedEntity: converted.convertedEntity
  };
}
