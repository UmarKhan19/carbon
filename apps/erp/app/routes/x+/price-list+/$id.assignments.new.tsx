import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PriceListDetail } from "~/modules/pricing";
import {
  createPriceListAssignment,
  priceListAssignmentValidator
} from "~/modules/pricing";
import { PriceListAssignmentForm } from "~/modules/pricing/ui/PriceListAssignments";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Price list ID not found");

  const formData = await request.formData();
  const validation = await validator(priceListAssignmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createPriceListAssignment(client, companyId, userId, {
    ...validation.data,
    priceListId: id
  });

  if (result.error) {
    return redirect(
      path.to.priceListAssignments(id),
      await flash(request, error(result.error, "Failed to add assignment"))
    );
  }

  return redirect(
    path.to.priceListAssignments(id),
    await flash(request, success("Assignment added"))
  );
}

export default function NewPriceListAssignmentRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) throw new Error("Price list ID not found");

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id)
  );

  return (
    <PriceListAssignmentForm
      initialValues={{ priceListId: id }}
      priceListType={routeData?.priceList?.type ?? "Sales"}
      onClose={() => navigate(path.to.priceListAssignments(id))}
    />
  );
}
