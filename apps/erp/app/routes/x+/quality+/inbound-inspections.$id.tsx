import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import {
  getInboundInspection,
  getInboundInspectionLotTrackedEntities
} from "~/modules/quality";
import InboundInspectionLotView from "~/modules/quality/ui/InboundInspections/InboundInspectionLotView";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

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

  if ((inspection.data as any).companyId !== companyId) {
    throw redirect(path.to.inboundInspections);
  }

  const lotEntities = await getInboundInspectionLotTrackedEntities(
    client,
    (inspection.data as any).receiptLineId,
    companyId
  );

  return data({
    inspection: inspection.data,
    lotEntities: lotEntities.data ?? [],
    enforceFourEyes:
      ((settings.data as any)?.enforceInspectionFourEyes as boolean) ?? false,
    currentUserId: userId
  });
}

export default function InboundInspectionRoute() {
  const { inspection, lotEntities, enforceFourEyes, currentUserId } =
    useLoaderData<typeof loader>();

  const insp = inspection as any;
  const receiptReadableId = insp.receipt?.receiptId ?? null;
  const receiverId = insp.receipt?.createdBy ?? null;
  const itemName = insp.item?.name ?? "";
  const supplierName = insp.supplier?.name ?? null;
  const samples = (insp.inboundInspectionSample ?? []) as any[];

  return (
    <InboundInspectionLotView
      inspection={{
        id: insp.id,
        itemId: insp.itemId,
        itemReadableId: insp.itemReadableId,
        lotSize: Number(insp.lotSize ?? 0),
        sampleSize: Number(insp.sampleSize ?? 0),
        acceptanceNumber: Number(insp.acceptanceNumber ?? 0),
        rejectionNumber: Number(insp.rejectionNumber ?? 1),
        samplingStandard: insp.samplingStandard,
        samplingPlanType: insp.samplingPlanType,
        aql: insp.aql,
        inspectionLevel: insp.inspectionLevel,
        severity: insp.severity,
        codeLetter: insp.codeLetter,
        status: insp.status,
        dispositionedAt: insp.dispositionedAt ?? null,
        receiptId: insp.receiptId
      }}
      receiptReadableId={receiptReadableId}
      receiverId={receiverId}
      itemName={itemName}
      supplierName={supplierName}
      samples={samples}
      lotEntities={lotEntities as any[]}
      currentUserId={currentUserId}
      enforceFourEyes={enforceFourEyes}
    />
  );
}
