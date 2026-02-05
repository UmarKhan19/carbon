import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const { data } = await client
    .from("assemblyProject")
    .select(
      "status, parsingProgress, parsingError, simulationStatus, simulationError"
    )
    .eq("id", params.id!)
    .eq("companyId", companyId)
    .single();

  return data;
}
