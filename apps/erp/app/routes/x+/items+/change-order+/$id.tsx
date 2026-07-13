import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
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
  getChangeOrderSupersessions,
  getChangeOrderTypesList,
  getConfigurationParameters,
  getConfigurationRules,
  getItemManufacturing,
  getMakeMethodById,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "~/modules/items";
import { getRevisionLock } from "~/modules/items/items.server";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import {
  ChangeOrderHeader,
  ChangeOrderProperties
} from "~/modules/items/ui/ChangeOrder";
import { getIssue, getIssues } from "~/modules/quality";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
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

  // Per affected item: load its CO-owned Draft make method's real rows shaped
  // exactly as the embedded BillOfMaterial / BillOfProcess editors expect (same
  // assembly as x+/part+/$itemId.make.$makeMethodId). The draft lives on the
  // same item for a Version, or on the new item (newItemId) for Revision/New Part.
  const affectedItems: AffectedItemDraft[] = await Promise.all(
    affectedRows.map(async (affectedItem) => {
      const draftItemId = affectedItem.newItemId ?? affectedItem.itemId;
      const draftMakeMethodId = affectedItem.draftMakeMethodId;

      if (!draftMakeMethodId) {
        return {
          affectedItem,
          draftItemId,
          makeMethod: null,
          methodMaterials: [],
          methodOperations: [],
          tags: [],
          configurable: false,
          configurationRules: [],
          parameters: [],
          replenishmentSystem: undefined,
          revisionStatus: null,
          releaseControl: null,
          diff: diffByAffectedId.get(affectedItem.id)
        };
      }

      const [
        makeMethod,
        methodMaterials,
        methodOperations,
        tags,
        manufacturing,
        revisionLock
      ] = await Promise.all([
        getMakeMethodById(client, draftMakeMethodId, companyId),
        getMethodMaterialsByMakeMethod(client, draftMakeMethodId),
        getMethodOperationsByMakeMethodId(client, draftMakeMethodId),
        getTagsList(client, companyId, "operation"),
        getItemManufacturing(client, draftItemId, companyId),
        getRevisionLock(client, { itemId: draftItemId, companyId })
      ]);

      const config = manufacturing.data?.requiresConfiguration
        ? {
            parameters: (
              await getConfigurationParameters(client, draftItemId, companyId)
            ).parameters,
            configurationRules: await getConfigurationRules(
              client,
              draftItemId,
              companyId
            )
          }
        : {
            parameters: [] as Awaited<
              ReturnType<typeof getConfigurationParameters>
            >["parameters"],
            configurationRules: [] as Awaited<
              ReturnType<typeof getConfigurationRules>
            >
          };

      return {
        affectedItem,
        draftItemId,
        makeMethod: makeMethod.data ?? null,
        methodMaterials:
          methodMaterials.data?.map((m) => ({
            ...m,
            description: m.item?.name ?? "",
            methodOperationId: m.methodOperationId ?? undefined,
            methodType: m.methodType as MethodType,
            itemType: m.itemType as MethodItemType
          })) ?? [],
        methodOperations:
          methodOperations.data?.map((operation) => ({
            ...operation,
            description: operation.description ?? "",
            procedureId: operation.procedureId ?? undefined,
            operationSupplierProcessId:
              operation.operationSupplierProcessId ?? undefined,
            operationMinimumCost: operation.operationMinimumCost ?? 0,
            operationLeadTime: operation.operationLeadTime ?? 0,
            operationUnitCost: operation.operationUnitCost ?? 0,
            tags: operation.tags ?? [],
            workCenterId: operation.workCenterId ?? undefined,
            workInstruction: operation.workInstruction as JSONContent | null
          })) ?? [],
        tags: tags.data ?? [],
        configurable: manufacturing.data?.requiresConfiguration ?? false,
        configurationRules: config.configurationRules,
        parameters: config.parameters,
        replenishmentSystem: undefined as string | undefined,
        revisionStatus: revisionLock.revisionStatus,
        releaseControl: revisionLock.releaseControl,
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
