import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageUnitChildren } from "~/modules/inventory";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "inventory" });

  const url = new URL(request.url);
  const parentId = url.searchParams.get("parentId");

  if (!parentId) {
    return { data: [], error: null };
  }

  const result = await getStorageUnitChildren(client, parentId);

  if (result.error) {
    return { data: [], error: result.error };
  }

  return { data: result.data ?? [], error: null };
}
