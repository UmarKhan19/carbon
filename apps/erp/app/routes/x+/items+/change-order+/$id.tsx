import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import {
  getChangeOrder,
  getChangeOrderActions,
  getChangeOrderAffectedItems,
  getChangeOrderDiff,
  getChangeOrderImpact,
  getChangeOrderStagedItemAttributes,
  getChangeOrderStagedMaterials,
  getChangeOrderStagedOperationChildren,
  getChangeOrderStagedOperations,
  getChangeOrderSupersessions,
  getChangeOrderTypesList
} from "~/modules/items";
import type { AffectedItemStaging } from "~/modules/items/ui/ChangeOrder";
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
    affected,
    diff,
    supersessions,
    actions,
    impact,
    nonConformances
  ] = await Promise.all([
    getChangeOrder(client, id, companyId),
    getChangeOrderTypesList(client, companyId),
    getChangeOrderAffectedItems(client, id, companyId),
    getChangeOrderDiff(client, id, companyId),
    getChangeOrderSupersessions(client, id, companyId),
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

  const affectedRows = affected.data ?? [];
  const diffByAffectedId = new Map(
    (diff.data?.items ?? []).map((entry) => [entry.affectedItemId, entry])
  );

  // Per affected item: load its staged BOM/BOP/attributes + the source item's
  // current editable attributes (the "old" side of the redline). Flat reads +
  // JS stitch (no composite-FK embeds — the erp TS2589 budget).
  const affectedItems: AffectedItemStaging[] = await Promise.all(
    affectedRows.map(async (affectedItem) => {
      const [materials, operations, attributes, source] = await Promise.all([
        getChangeOrderStagedMaterials(client, affectedItem.id, companyId),
        getChangeOrderStagedOperations(client, affectedItem.id, companyId),
        getChangeOrderStagedItemAttributes(client, affectedItem.id, companyId),
        client
          .from("item")
          .select(
            "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, requiresInspection, thumbnailPath, modelUploadId"
          )
          .eq("id", affectedItem.itemId)
          .eq("companyId", companyId)
          .maybeSingle()
      ]);

      // Staged BOP operation children (steps/params/tools) per staged operation,
      // keyed by staged operation id — so existing children render in the editor,
      // not just the add-forms. Flat reads + JS stitch (TS2589 budget).
      const operationRows = operations.data ?? [];
      const childrenEntries = await Promise.all(
        operationRows.map(async (operation) => {
          const children = await getChangeOrderStagedOperationChildren(
            client,
            operation.id,
            companyId
          );
          return [operation.id, children.data] as const;
        })
      );
      const operationChildren = Object.fromEntries(childrenEntries);

      return {
        affectedItem,
        materials: materials.data ?? [],
        operations: operationRows,
        operationChildren,
        attributes: attributes.data ?? null,
        source: {
          itemId: affectedItem.itemId,
          name: source.data?.name ?? null,
          description: source.data?.description ?? null,
          unitOfMeasureCode: source.data?.unitOfMeasureCode ?? null,
          itemTrackingType: source.data?.itemTrackingType ?? null,
          defaultMethodType: source.data?.defaultMethodType ?? null,
          replenishmentSystem: source.data?.replenishmentSystem ?? null,
          sourcingType: source.data?.sourcingType ?? null,
          requiresInspection: source.data?.requiresInspection ?? null,
          thumbnailPath: source.data?.thumbnailPath ?? null,
          modelId: source.data?.modelUploadId ?? null
        },
        diff: diffByAffectedId.get(affectedItem.id)
      };
    })
  );

  // Affected assemblies (Properties sidebar): in the top-to-bottom model the
  // affected items themselves are the changed products.
  const affectedAssemblies = affectedRows.map((r) => ({
    id: r.itemId,
    readableIdWithRevision: r.item?.readableIdWithRevision ?? null,
    name: r.item?.name ?? null
  }));

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
    affectedItems,
    diff: diff.data ?? { items: [], supersessions: [] },
    supersessions: supersessions.data ?? [],
    actions: actions.data ?? [],
    affectedAssemblies,
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
