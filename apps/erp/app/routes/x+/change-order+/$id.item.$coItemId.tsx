import { requirePermissions } from "@carbon/auth/auth.server";
import { Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuArrowRight, LuPencil } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useParams } from "react-router";
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
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Affected Item"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "plm",
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
  // revision" lands directly on its BOM/BOP editor. The pending item is in
  // Design status, so its method is unlocked/editable.
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
      ? `${path.to.partDetails(item.pendingItemId)}?methodId=${active.id}`
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

  const canEdit = permissions.can("update", "plm");

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

  return (
    <VStack spacing={2}>
      <Card>
        <HStack className="justify-between w-full items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Affected Item</Trans>
            </CardTitle>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  <Trans>Before</Trans>
                </span>
                <span className="font-semibold">
                  {item.readableIdWithRevision}
                </span>
                {item.revisionStatus && (
                  <span className="text-xs text-muted-foreground">
                    {item.revisionStatus}
                  </span>
                )}
              </div>
              {item.pendingItem?.readableIdWithRevision && (
                <>
                  <LuArrowRight className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">
                      <Trans>After</Trans>
                    </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {item.pendingItem.readableIdWithRevision}
                    </span>
                    {item.pendingItem.revisionStatus && (
                      <span className="text-xs text-muted-foreground">
                        {item.pendingItem.revisionStatus}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
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
          </CardContent>
        </HStack>
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
        <>
          <RedlineDiff current={current} pending={pending} />
          {editButton && <div className="self-start">{editButton}</div>}
        </>
      ) : (
        <Card>
          <CardContent className="py-10 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium">
              <Trans>No changes proposed yet</Trans>
            </p>
            <p className="text-sm text-muted-foreground max-w-md">
              <Trans>
                The proposed revision is an exact copy of the current revision.
                Edit the proposed revision to redline its BOM/BOP.
              </Trans>
            </p>
            {editButton}
          </CardContent>
        </Card>
      )}
    </VStack>
  );
}
