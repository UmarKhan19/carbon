import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeNotice, ChangeNoticeActionTask } from "~/modules/items";
import { getChangeNoticeImpactWorkspace } from "~/modules/items";
import { getChangeNoticeImpactReadAccess } from "~/modules/items/items.server";
import { ChangeNoticeImpactWorkspace } from "~/modules/items/ui/ChangeNotice";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const access = await getChangeNoticeImpactReadAccess({
    client,
    userId,
    companyId
  });
  if (access.status === "resolved" && !access.canViewChangeNotice) {
    throw new Response("Forbidden", { status: 403 });
  }

  const sourceAccess =
    access.status === "failed"
      ? access
      : { status: "resolved" as const, access: access.sourceAccess };
  const result = await getChangeNoticeImpactWorkspace(client, companyId, id, {
    sourceAccess
  });
  if (result.error || !result.data) {
    throw new Response("Impact workspace unavailable", { status: 503 });
  }
  return result.data;
}

export default function ChangeNoticeImpactRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const data = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    actions: ChangeNoticeActionTask[];
  }>(path.to.changeNotice(id));
  return (
    <ChangeNoticeImpactWorkspace
      id={id}
      changeNotice={routeData?.changeNotice ?? null}
      data={data}
      actions={routeData?.actions ?? []}
    />
  );
}
