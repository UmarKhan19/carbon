import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  accountCategoryValidator,
  getAccountCategory,
  upsertAccountCategory
} from "~/modules/accounting";
import { AccountCategoryForm } from "~/modules/accounting/ui/AccountCategories";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const accountCategory = await getAccountCategory(
    client,
    categoryId,
    companyGroupId
  );
  if (accountCategory.error) {
    throw redirect(
      path.to.accountingCategories,
      await flash(
        request,
        error(accountCategory.error, "Failed to fetch G/L account category")
      )
    );
  }

  return { accountCategory: accountCategory.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(accountCategoryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateCategory = await upsertAccountCategory(client, {
    id,
    ...d,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateCategory.error) {
    throw redirect(
      `${path.to.accountingCategories}?${getParams(request)}`,
      await flash(
        request,
        error(updateCategory.error, "Failed to update G/L account category")
      )
    );
  }

  throw redirect(
    `${path.to.accountingCategories}?${getParams(request)}`,
    await flash(request, success("Updated G/L account category "))
  );
}

export default function EditAccountCategoryRoute() {
  const { accountCategory } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.accountingCategories);

  const initialValues = {
    ...accountCategory,
    ...getCustomFields(accountCategory.customFields)
  };

  return (
    <AccountCategoryForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
