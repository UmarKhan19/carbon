import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetValidator,
  getFixedAssetClassesList,
  upsertFixedAsset
} from "~/modules/accounting";
import { FixedAssetForm } from "~/modules/accounting/ui/FixedAssets";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const assetClasses = await getFixedAssetClassesList(client, companyId);

  return {
    assetClasses: assetClasses.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const nextSequence = await getNextSequence(client, "fixedAsset", companyId);
  if (nextSequence.error) {
    return redirect(
      path.to.fixedAssets,
      await flash(
        request,
        error(nextSequence.error, "Failed to generate asset ID")
      )
    );
  }

  const status =
    d.acquisitionCost && d.acquisitionCost > 0 && d.acquisitionDate
      ? "Active"
      : "Draft";

  const result = await upsertFixedAsset(client, {
    ...d,
    fixedAssetId: nextSequence.data,
    status,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return redirect(
      path.to.fixedAssets,
      await flash(request, error(result.error, "Failed to create fixed asset"))
    );
  }

  throw redirect(
    path.to.fixedAsset(result.data.id),
    await flash(request, success("Fixed asset created"))
  );
}

export default function NewFixedAssetRoute() {
  const { assetClasses } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    fixedAssetClassId: "",
    name: "",
    description: "",
    serialNumber: "",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 60,
    residualValuePercent: 0
  };

  return (
    <FixedAssetForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
      assetClasses={assetClasses}
    />
  );
}
