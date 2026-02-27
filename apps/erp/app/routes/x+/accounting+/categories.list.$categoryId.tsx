import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { useUrlParams } from "~/hooks";
import {
  getAccountCategory,
  getAccountSubcategoriesByCategory
} from "~/modules/accounting";
import { AccountCategoryDetail } from "~/modules/accounting/ui/AccountCategories";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const [accountCategory, accountSubcategories] = await Promise.all([
    getAccountCategory(client, categoryId, companyGroupId),
    getAccountSubcategoriesByCategory(client, categoryId)
  ]);
  if (accountCategory.error) {
    throw redirect(
      path.to.accountingCategories,
      await flash(
        request,
        error(accountCategory.error, "Failed to fetch account category")
      )
    );
  }

  if (accountSubcategories.error) {
    throw redirect(
      path.to.accountingCategories,
      await flash(
        request,
        error(
          accountSubcategories.error,
          "Failed to fetch account subcategories"
        )
      )
    );
  }

  return {
    accountCategory: accountCategory.data,
    accountSubcategories: accountSubcategories.data ?? []
  };
}

export default function AccountCategoryListRoute() {
  const { accountCategory, accountSubcategories } =
    useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const onClose = () =>
    navigate(`${path.to.accountingCategories}?${params.toString()}`);

  return (
    <>
      <AccountCategoryDetail
        // @ts-expect-error
        accountCategory={accountCategory}
        accountSubcategories={accountSubcategories}
        onClose={onClose}
      />
      <Outlet />
    </>
  );
}
