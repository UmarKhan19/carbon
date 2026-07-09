import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import {
  getAssembliesUsingItem,
  getChangeOrder,
  getChangeOrderActions,
  getChangeOrderBomChanges,
  getChangeOrderImpact,
  getChangeOrderProductsAffected,
  getChangeOrderTypesList
} from "~/modules/items";
import {
  ChangeOrderHeader,
  ChangeOrderProperties
} from "~/modules/items/ui/ChangeOrder";
import { getIssue, getIssues } from "~/modules/quality";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders,
  module: "parts"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    changeOrder,
    types,
    productsAffected,
    bomChanges,
    actions,
    impact,
    nonConformances
  ] = await Promise.all([
    getChangeOrder(client, id, companyId),
    getChangeOrderTypesList(client, companyId),
    getChangeOrderProductsAffected(client, id, companyId),
    getChangeOrderBomChanges(client, id, companyId),
    getChangeOrderActions(client, id, companyId),
    getChangeOrderImpact(client, id, companyId),
    // NCR cross-link picker options (4a).
    getIssues(client, companyId)
  ]);

  if (changeOrder.error) {
    throw redirect(
      path.to.changeOrders,
      await flash(
        request,
        error(changeOrder.error, "Failed to load change order")
      )
    );
  }

  // Human label for the currently-linked NCR (so the sidebar link shows the
  // readable id/name, not the raw id).
  const linkedNonConformanceId = changeOrder.data?.nonConformanceId ?? null;
  const linkedNonConformance = linkedNonConformanceId
    ? (await getIssue(client, linkedNonConformanceId)).data
    : null;

  const bomChangeRows = bomChanges.data ?? [];

  // Per Delete row: the assemblies whose make method actually consumes the part
  // — the only valid targets to delete it from. These become the row's assembly
  // picker options (a fixed list, no free-text/create). Add rows choose freely,
  // so they get no options here.
  const suggestedEntries = await Promise.all(
    bomChangeRows
      .filter((r) => r.changeType === "Delete" && r.itemId)
      .map(async (r) => {
        const using = await getAssembliesUsingItem(
          client,
          r.itemId as string,
          companyId
        );
        const options = (using.data ?? []).map((a) => ({
          value: a.assemblyId,
          label: a.assemblyName
            ? `${a.assemblyReadableId ?? a.assemblyId} — ${a.assemblyName}`
            : (a.assemblyReadableId ?? a.assemblyId)
        }));
        return [r.id, options] as const;
      })
  );
  const suggestedAssembliesByRow: Record<
    string,
    { value: string; label: string }[]
  > = Object.fromEntries(suggestedEntries);

  // Distinct assemblies referenced by any BOM-change row (for the Properties
  // sidebar). Deduped by assembly id.
  const affectedAssembliesMap = new Map<
    string,
    { id: string; readableIdWithRevision: string | null; name: string | null }
  >();
  for (const row of bomChangeRows) {
    for (const assembly of row.assemblies ?? []) {
      const a = assembly.assembly;
      if (a && !affectedAssembliesMap.has(a.id)) {
        affectedAssembliesMap.set(a.id, {
          id: a.id,
          readableIdWithRevision: a.readableIdWithRevision,
          name: a.name
        });
      }
    }
  }

  // Minimal, explicit option shape (cheap type — avoids widening the loader's
  // instantiation surface with the full issues-view row).
  const nonConformanceOptions: {
    id: string;
    nonConformanceId: string;
    name: string;
  }[] = (nonConformances.data ?? []).flatMap((nc) =>
    nc.id && nc.nonConformanceId
      ? [
          {
            id: nc.id,
            nonConformanceId: nc.nonConformanceId,
            name: nc.name ?? ""
          }
        ]
      : []
  );

  return {
    changeOrder: changeOrder.data,
    types: types.data ?? [],
    productsAffected: productsAffected.data ?? [],
    bomChanges: bomChangeRows,
    suggestedAssembliesByRow,
    actions: actions.data ?? [],
    affectedAssemblies: Array.from(affectedAssembliesMap.values()),
    impact: impact.data ?? [],
    nonConformanceOptions,
    linkedNonConformance: linkedNonConformance
      ? {
          id: linkedNonConformance.id,
          nonConformanceId: linkedNonConformance.nonConformanceId,
          name: linkedNonConformance.name
        }
      : null
  };
}

export default function ChangeOrderIdRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  // Surfaced to child routes + header/properties via useRouteData.
  useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ChangeOrderHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
            <VStack spacing={2} className="p-2">
              <Outlet />
            </VStack>
          </div>
          <ChangeOrderProperties key={id} />
        </div>
      </div>
    </div>
  );
}
