import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import invariant from "tiny-invariant";
import {
  getInboundInspection,
  inboundInspectionValidator,
  updateInboundInspection
} from "~/modules/quality";
import InboundInspectionForm from "~/modules/quality/ui/InboundInspections/InboundInspectionForm";
import { getCompanySettings } from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const [inspection, settings] = await Promise.all([
    getInboundInspection(client, id),
    getCompanySettings(client, companyId)
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inboundInspections,
      await flash(request, error(inspection.error, "Failed to load inspection"))
    );
  }

  if (inspection.data.companyId !== companyId) {
    throw redirect(path.to.inboundInspections);
  }

  return data({
    inspection: inspection.data,
    enforceFourEyes: settings.data?.enforceInspectionFourEyes ?? false,
    currentUserId: userId
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  const validation = await validator(inboundInspectionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const existing = await getInboundInspection(client, id);
  if (existing.error || !existing.data) {
    throw redirect(
      path.to.inboundInspections,
      await flash(request, error(existing.error, "Failed to load inspection"))
    );
  }
  if (existing.data.companyId !== companyId) {
    throw redirect(path.to.inboundInspections);
  }

  const result = await updateInboundInspection(client, {
    ...validation.data,
    companyId,
    trackedEntityId: existing.data.trackedEntityId,
    receiptId: existing.data.receiptId,
    // @ts-ignore - relation
    receiptReadableId: existing.data.receipt?.receiptId ?? null,
    inspectedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.inboundInspection(id),
      await flash(request, error(result.error, "Failed to update inspection"))
    );
  }

  throw redirect(
    `${path.to.inboundInspections}?${getParams(request)}`,
    await flash(request, success("Inspection submitted"))
  );
}

export default function InboundInspectionRoute() {
  const { inspection, enforceFourEyes, currentUserId } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // @ts-ignore - relation data
  const itemName = inspection.item?.name ?? "";
  // @ts-ignore - relation data
  const itemReadableId =
    inspection.item?.readableId ?? inspection.itemReadableId ?? "";
  // @ts-ignore - relation data
  const receiptReadableId = inspection.receipt?.receiptId ?? "";
  // @ts-ignore - relation data
  const receiverId = inspection.receipt?.createdBy ?? null;
  // @ts-ignore - relation data
  const attributes = (inspection.trackedEntity?.attributes ?? {}) as Record<
    string,
    string
  >;
  const serialOrBatch =
    attributes["Serial Number"] ?? attributes["Batch Number"] ?? "";

  const alreadyInspected = inspection.status !== "Pending";

  return (
    <InboundInspectionForm
      inspectionId={inspection.id}
      itemReadableId={itemReadableId}
      itemName={itemName}
      serialOrBatch={serialOrBatch}
      receiptReadableId={receiptReadableId}
      receiverId={receiverId}
      currentUserId={currentUserId}
      enforceFourEyes={enforceFourEyes}
      disabled={alreadyInspected}
      action={path.to.inboundInspection(inspection.id)}
      onClose={() => navigate(-1)}
    />
  );
}
