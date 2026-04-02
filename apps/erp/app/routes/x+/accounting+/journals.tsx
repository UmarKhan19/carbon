import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { getJournalEntries } from "~/modules/accounting";
import { JournalEntriesTable } from "~/modules/accounting/ui/JournalEntries";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Journal Entries",
  to: path.to.accountingJournals
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const entries = await getJournalEntries(client, companyId, {
    search,
    status,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: entries.data ?? [],
    count: entries.count ?? 0
  };
}

export default function JournalEntriesRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const permissions = usePermissions();

  return (
    <VStack spacing={0} className="h-full">
      <JournalEntriesTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <New label="Journal Entry" to={`new?${params.toString()}`} />
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
