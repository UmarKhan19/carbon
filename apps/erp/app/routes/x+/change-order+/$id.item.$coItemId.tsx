import { requirePermissions } from "@carbon/auth/auth.server";
import { Select, ValidatedForm } from "@carbon/form";
import { Button, Card, CardContent, cn, toast, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { LuArrowRight, LuPencil } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { usePermissions } from "~/hooks";
import {
  changeOrderDisposition,
  getChangeOrderItems,
  getMakeMethods
} from "~/modules/items";
import { getMethodSnapshot } from "~/modules/items/changeOrder.server";
import { DispositionStatus } from "~/modules/items/ui/ChangeOrder/ChangeOrderItems";
import RedlineDiff, {
  getRedlineCounts
} from "~/modules/items/ui/ChangeOrder/RedlineDiff";
import ItemRevisionStatus from "~/modules/items/ui/Item/ItemRevisionStatus";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";
import type { MethodItemType } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Affected Item"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { id, coItemId } = params;
  if (!id) throw new Error("Could not find id");
  if (!coItemId) throw new Error("Could not find coItemId");

  const items = await getChangeOrderItems(client, id, companyId);
  const item = (items.data ?? []).find((i) => i.id === coItemId) ?? null;
  if (!item) throw new Error("Affected item not found");

  // Build the BEFORE (current revision) vs AFTER (proposed revision) method
  // snapshots. When the item has no pending revision (e.g. a Buy item) the
  // after side is empty and there is nothing to redline.
  const [current, pending] = await Promise.all([
    getMethodSnapshot(client, item.itemId, companyId),
    getMethodSnapshot(client, item.pendingItemId, companyId)
  ]);

  const counts = getRedlineCounts(current, pending);
  const hasChanges = counts.added + counts.removed + counts.changed > 0;

  // Resolve the proposed revision's active make method so "Edit proposed
  // revision" lands directly on its BOM/BOP editor, routed by the item's type
  // (Part → part editor, Tool → tool editor). The pending item is in Design
  // status, so its method is unlocked/editable.
  const itemType = (item.itemType ?? "Part") as MethodItemType;
  let editLink: string | null = null;
  if (item.pendingItemId) {
    const makeMethods = await getMakeMethods(
      client,
      item.pendingItemId,
      companyId
    );
    const active =
      makeMethods.data?.find((m) => m.status === "Active") ??
      makeMethods.data?.[0];
    editLink = active
      ? getPathToMakeMethod(itemType, item.pendingItemId, active.id)
      : itemType === "Tool"
        ? path.to.toolDetails(item.pendingItemId)
        : path.to.partDetails(item.pendingItemId);
  }

  return { item, current, pending, hasChanges, editLink };
}

export default function ChangeOrderAffectedItemRoute() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { item, current, pending, hasChanges, editLink } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: { message: string } | null }>();

  const canEdit = permissions.can("update", "production");

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdateDisposition = useCallback(
    (value: string) => {
      const formData = new FormData();
      formData.append("intent", "disposition");
      formData.append("id", item.id);
      formData.append("field", "disposition");
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateChangeOrderItem
      });
    },
    [fetcher, item.id]
  );

  const editButton =
    editLink && canEdit ? (
      <Button asChild leftIcon={<LuPencil />}>
        <Link to={editLink}>
          <Trans>Edit proposed revision</Trans>
        </Link>
      </Button>
    ) : null;

  const after = item.pendingItem?.readableIdWithRevision
    ? {
        id: item.pendingItem.readableIdWithRevision,
        status: item.pendingItem.revisionStatus
      }
    : null;

  return (
    <VStack spacing={2}>
      <Card>
        <CardContent className="p-4">
          <VStack spacing={4} className="w-full">
            <div className="flex w-full flex-wrap items-start justify-between gap-4">
              <VStack spacing={3}>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Trans>Affected Item</Trans>
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <RevisionCell
                    label={<Trans>Before</Trans>}
                    id={item.readableIdWithRevision}
                    status={item.revisionStatus}
                  />
                  {after && (
                    <>
                      <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      <RevisionCell
                        label={<Trans>After</Trans>}
                        id={after.id}
                        status={after.status}
                        highlight
                      />
                    </>
                  )}
                </div>
              </VStack>
              <ValidatedForm
                defaultValues={{ disposition: item.disposition ?? "No Change" }}
                validator={z.object({ disposition: z.string() })}
                className="w-[160px]"
              >
                <Select
                  name="disposition"
                  label={t`Disposition`}
                  isReadOnly={!canEdit}
                  options={changeOrderDisposition.map((d) => ({
                    value: d,
                    label: <DispositionStatus disposition={d} />
                  }))}
                  inline={(value) => (
                    <div className="h-8 flex items-center">
                      <DispositionStatus disposition={value} />
                    </div>
                  )}
                  onChange={(option) => {
                    if (option) onUpdateDisposition(option.value);
                  }}
                />
              </ValidatedForm>
            </div>
            {editButton && <div>{editButton}</div>}
          </VStack>
        </CardContent>
      </Card>

      {!item.pendingItemId ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              <Trans>
                This item has no proposed revision, so there is nothing to
                redline.
              </Trans>
            </p>
          </CardContent>
        </Card>
      ) : hasChanges ? (
        <RedlineDiff current={current} pending={pending} />
      ) : (
        <Card>
          <CardContent className="py-10 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium">
              <Trans>No changes proposed yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground max-w-md">
              <Trans>
                The proposed revision is an exact copy of the current revision.
                Use “Edit proposed revision” above to redline its BOM/BOP.
              </Trans>
            </p>
          </CardContent>
        </Card>
      )}
    </VStack>
  );
}

// Before/After revision cell: item id + a lifecycle status badge whose tooltip
// explains what the stage (Design/Prototype/Production/Obsolete) means.
function RevisionCell({
  label,
  id,
  status,
  highlight = false
}: {
  label: ReactNode;
  id: string | null;
  status?: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <AiOutlinePartition className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "font-semibold",
            highlight && "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {id}
        </span>
        {status ? (
          <ItemRevisionStatus
            status={
              status as ComponentProps<typeof ItemRevisionStatus>["status"]
            }
            withHelp
          />
        ) : null}
      </div>
    </div>
  );
}
