import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { arrayToTree } from "performant-array-to-tree";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import type { Group } from "~/modules/users";
import { getCompanyId, groupsByTypeQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type");
  const includeUsers = searchParams.get("include") === "users";
  const withCounts = searchParams.get("counts") === "true";

  const selectCols = includeUsers
    ? "id, name, companyId, isEmployeeTypeGroup, isCustomerOrgGroup, isCustomerTypeGroup, isSupplierOrgGroup, isSupplierTypeGroup, parentId, users"
    : "id, name, companyId, isEmployeeTypeGroup, isCustomerOrgGroup, isCustomerTypeGroup, isSupplierOrgGroup, isSupplierTypeGroup, parentId";

  const query = client
    .from("groups")
    .select(selectCols)
    .eq("companyId", companyId);

  if (type === "employee") {
    query.eq("isCustomerOrgGroup", false);
    query.eq("isCustomerTypeGroup", false);
    query.eq("isSupplierOrgGroup", false);
    query.eq("isSupplierTypeGroup", false);
  } else if (type === "customer") {
    query.or("isCustomerTypeGroup.eq.true, isCustomerOrgGroup.eq.true");
  } else if (type === "supplier") {
    query.or("isSupplierTypeGroup.eq.true, isSupplierOrgGroup.eq.true");
  }

  const groups = await query;

  if (groups.error) {
    return data(
      { groups: [], error: groups.error },
      await flash(request, error(groups.error, "Failed to load groups"))
    );
  }

  let rows = groups.data ?? [];

  // Attach a real (transitive) member count per group so the picker can show
  // "N members" without expanding. `users_for_groups` resolves nested
  // subgroups — a direct-user count would read 0 for a group whose members are
  // all in subgroups (e.g. "All Employees" containing an "Admin" group).
  if (withCounts) {
    const ids = Array.from(new Set(rows.map((g: any) => g.id).filter(Boolean)));
    const counts = await Promise.all(
      ids.map(async (id) => {
        const res = await client.rpc("users_for_groups", { groups: [id] });
        const members = Array.isArray(res.data) ? (res.data as string[]) : [];
        return [id, members.length] as const;
      })
    );
    const countById = new Map(counts);
    rows = rows.map((g: any) => ({
      ...g,
      memberCount: countById.get(g.id) ?? 0
    }));
  }

  return {
    groups: arrayToTree(rows) as Group[]
  };
}

export async function clientLoader({
  request,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  const queryKey = groupsByTypeQuery(companyId, type).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
