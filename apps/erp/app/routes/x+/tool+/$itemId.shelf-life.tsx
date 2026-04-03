import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Shelf life configuration has moved to the Inventory tab.
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "parts" });
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  throw redirect(path.to.toolInventory(itemId));
}
