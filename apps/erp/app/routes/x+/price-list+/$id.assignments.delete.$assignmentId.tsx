import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePriceListAssignment, getPriceListType } from "~/modules/pricing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { role: "employee" });
  if (!params.assignmentId) throw notFound("Assignment ID not found");
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, { role: "employee" });

  const { id, assignmentId } = params;
  if (!id || !assignmentId) throw new Error("IDs not found");

  const plType = await getPriceListType(client, id);
  await requirePermissions(request, {
    delete: plType === "Purchase" ? "purchasing" : "sales"
  });

  const { error: deleteError } = await deletePriceListAssignment(
    client,
    assignmentId
  );
  if (deleteError) {
    throw redirect(
      path.to.priceListAssignments(id),
      await flash(request, error(deleteError, "Failed to remove assignment"))
    );
  }

  throw redirect(
    path.to.priceListAssignments(id),
    await flash(request, success("Assignment removed"))
  );
}

export default function DeletePriceListAssignmentRoute() {
  const { id, assignmentId } = useParams();
  const navigate = useNavigate();

  if (!id || !assignmentId) return null;

  return (
    <ConfirmDelete
      action={`${path.to.priceListAssignments(id)}/delete/${assignmentId}`}
      name="Assignment"
      text="Are you sure you want to remove this assignment?"
      onCancel={() => navigate(path.to.priceListAssignments(id))}
    />
  );
}
