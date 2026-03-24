import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { convertSalesOrderLinesToJobs } from "~/modules/production/production.service";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    create: "production"
  });

  const { orderId } = params;
  if (!orderId) {
    throw new Error("Invalid orderId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const salesOrder = await convertSalesOrderLinesToJobs(client, {
    orderId,
    companyId,
    userId
  });

  if (salesOrder.error) {
    const errorObj = salesOrder.error as any;
    const errorMessage =
      typeof errorObj === "string"
        ? errorObj
        : errorObj?.details || errorObj?.message || "Unknown error";

    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(
          salesOrder.error,
          `Failed to convert sales order lines to jobs: ${errorMessage}`
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesOrder(orderId),
    await flash(request, success("Jobs created"))
  );
}
