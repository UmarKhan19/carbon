import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getAccountSubcategoriesByCategory } from "~/modules/accounting";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const accountCategoryId = searchParams.get("accountCategoryId") as string;

  if (!accountCategoryId || accountCategoryId === "undefined")
    return {
      data: []
    };

  const subcategories = await getAccountSubcategoriesByCategory(
    client,
    accountCategoryId
  );
  if (subcategories.error) {
    return data(
      subcategories,
      await flash(
        request,
        error(subcategories.error, "Failed to get account subcategories")
      )
    );
  }

  return subcategories;
}
