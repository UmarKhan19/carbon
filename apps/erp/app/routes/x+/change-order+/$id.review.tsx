import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Card, CardContent, Heading, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuArrowRight, LuArrowUpRight, LuCheck } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useParams } from "react-router";
import { getChangeOrderItems } from "~/modules/items";
import { getMethodSnapshot } from "~/modules/items/changeOrder.server";
import { DispositionStatus } from "~/modules/items/ui/ChangeOrder/ChangeOrderItems";
import RedlineDiff, {
  getRedlineCounts
} from "~/modules/items/ui/ChangeOrder/RedlineDiff";
import RevisionCell from "~/modules/items/ui/ChangeOrder/RevisionCell";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Review"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [items, reviewer] = await Promise.all([
    getChangeOrderItems(client, id, companyId),
    // The current user's own reviewer row drives their personal review progress.
    client
      .from("changeOrderReviewer")
      .select("id, reviewedItemIds")
      .eq("changeOrderId", id)
      .eq("assignee", userId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  const affectedItems = items.data ?? [];
  const reviewedItemIds = reviewer.data?.reviewedItemIds ?? [];
  const isReviewer = Boolean(reviewer.data);

  // Build the Before (current) vs After (pending) method snapshots for every
  // affected item so a reviewer can read the whole change set in one scroll.
  const entries = await Promise.all(
    affectedItems.map(async (item) => {
      const [current, pending] = await Promise.all([
        getMethodSnapshot(client, item.itemId, companyId),
        getMethodSnapshot(client, item.pendingItemId, companyId)
      ]);
      const counts = getRedlineCounts(current, pending);
      return {
        item,
        current,
        pending,
        hasChanges: counts.added + counts.removed + counts.changed > 0
      };
    })
  );

  return { entries, reviewedItemIds, isReviewer };
}

export default function ChangeOrderReviewRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { entries, reviewedItemIds, isReviewer } =
    useLoaderData<typeof loader>();
  const reviewedSet = new Set(reviewedItemIds);
  const reviewedCount = entries.filter((e) =>
    reviewedSet.has(e.item.id)
  ).length;

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Trans>No affected items to review yet.</Trans>
        </CardContent>
      </Card>
    );
  }

  return (
    <VStack spacing={4} className="w-full">
      <div className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Heading size="h4">
            <Trans>Review all changes</Trans>
          </Heading>
          <span className="text-sm text-muted-foreground">
            <Trans>{entries.length} affected items</Trans>
          </span>
        </div>
        {isReviewer && (
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            <Trans>
              you: {reviewedCount}/{entries.length} reviewed
            </Trans>
          </span>
        )}
      </div>

      {entries.map(({ item, current, pending, hasChanges }) => (
        <Card key={item.id} className="w-full">
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <RevisionCell
                  label={<Trans>Before</Trans>}
                  id={item.readableIdWithRevision}
                  status={item.revisionStatus}
                />
                {item.pendingItem?.readableIdWithRevision && (
                  <>
                    <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    <RevisionCell
                      label={<Trans>After</Trans>}
                      id={item.pendingItem.readableIdWithRevision}
                      status={item.pendingItem.revisionStatus}
                      highlight
                    />
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <DispositionStatus
                  disposition={item.disposition ?? "No Change"}
                />
                {isReviewer && (
                  <ReviewToggle
                    changeOrderId={id}
                    coItemId={item.id}
                    reviewed={reviewedSet.has(item.id)}
                  />
                )}
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  rightIcon={<LuArrowUpRight />}
                >
                  <Link to={path.to.changeOrderItem(id, item.id)}>
                    <Trans>Open</Trans>
                  </Link>
                </Button>
              </div>
            </div>

            {hasChanges ? (
              <RedlineDiff current={current} pending={pending} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {item.pendingItemId ? (
                  <Trans>No method changes between revisions.</Trans>
                ) : (
                  <Trans>This item has no proposed revision.</Trans>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </VStack>
  );
}

// Per-reviewer "reviewed" toggle — a personal reading aid, not a binding gate.
// Optimistically reflects the pending fetcher value so the button flips instantly;
// the loader revalidates the reviewer's progress after.
function ReviewToggle({
  changeOrderId,
  coItemId,
  reviewed
}: {
  changeOrderId: string;
  coItemId: string;
  reviewed: boolean;
}) {
  const fetcher = useFetcher();

  const pending = fetcher.formData?.get("value");
  const isReviewed = pending != null ? pending === "true" : reviewed;

  return (
    <fetcher.Form method="post" action={path.to.updateChangeOrderItem}>
      <input type="hidden" name="intent" value="reviewed" />
      <input type="hidden" name="changeOrderId" value={changeOrderId} />
      <input type="hidden" name="coItemId" value={coItemId} />
      <input type="hidden" name="value" value={(!isReviewed).toString()} />
      <Button
        type="submit"
        size="sm"
        variant={isReviewed ? "primary" : "secondary"}
        leftIcon={isReviewed ? <LuCheck /> : undefined}
      >
        {isReviewed ? <Trans>Reviewed</Trans> : <Trans>Mark reviewed</Trans>}
      </Button>
    </fetcher.Form>
  );
}
