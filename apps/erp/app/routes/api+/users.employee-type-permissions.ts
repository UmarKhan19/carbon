import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import type { CompanyPermission } from "~/modules/users";
import { getPermissionsByEmployeeType } from "~/modules/users";
import { makeCompanyPermissionsFromEmployeeType } from "~/modules/users/users.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const url = new URL(request.url);
  const employeeTypeId = url.searchParams.get("employeeTypeId");

  if (!employeeTypeId) {
    return data(
      { permissions: null as Record<string, CompanyPermission> | null },
      await flash(request, error(null, "Employee type ID is required"))
    );
  }

  const employeeTypePermissions = await getPermissionsByEmployeeType(
    client,
    employeeTypeId
  );

  if (employeeTypePermissions.error) {
    return data(
      { permissions: null as Record<string, CompanyPermission> | null },
      await flash(
        request,
        error(employeeTypePermissions.error, "Failed to fetch permissions")
      )
    );
  }

  // Normalize keys to lowercase to match the format produced by
  // makeCompanyPermissionsFromClaims, so the permission matrix state
  // keys line up with its existing module definitions.
  const raw = makeCompanyPermissionsFromEmployeeType(
    employeeTypePermissions.data ?? [],
    companyId
  );
  const permissions: Record<string, CompanyPermission> = {};
  for (const [mod, entry] of Object.entries(raw)) {
    permissions[mod.toLowerCase()] = entry.permission;
  }

  return { permissions };
}
