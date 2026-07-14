import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuCircleCheck, LuGitMerge, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type {
  ChangeOrderMergeChoice,
  ChangeOrderMergeResolution,
  ChangeOrderReleaseConflict,
  ChangeOrderReleaseConflictEntry
} from "../../changeOrder.models";
import { changeOrderMergeEntryKey } from "../../changeOrder.models";
import ChangeOrderConflictResolver from "./ChangeOrderConflictResolver";

// Per-line state key: the affected item plus the shared line identity, so the
// selection map spans all affected items without collisions.
function stateKey(
  affectedItemId: string,
  e: ChangeOrderReleaseConflictEntry
): string {
  return `${affectedItemId}:${changeOrderMergeEntryKey(e)}`;
}

// The Implementation → Done release control. When a same-part parallel CO
// released first, the live method moved under this CO's Version draft; each
// affected part with conflicts is listed here and resolved one at a time in a
// full-screen git-style resolver (Q3). With no conflicts it's just the release
// button.
export default function ChangeOrderReleaseMerge({
  changeOrderId,
  status,
  conflicts
}: {
  changeOrderId: string;
  status: string | null;
  conflicts: ChangeOrderReleaseConflict[];
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const fetcher = useFetcher<{ success?: boolean }>();

  useEffect(() => {
    const err = (fetcher.data as { error?: { message: string } } | undefined)
      ?.error;
    if (err) toast.error(err.message);
  }, [fetcher.data]);

  // Per-line choice, seeded from the server's safe defaults.
  const [choices, setChoices] = useState<
    Record<string, ChangeOrderMergeChoice>
  >(() => {
    const seed: Record<string, ChangeOrderMergeChoice> = {};
    for (const c of conflicts) {
      for (const e of c.entries) {
        seed[stateKey(c.affectedItemId, e)] = e.defaultChoice;
      }
    }
    return seed;
  });

  // Parts the user has opened and confirmed. Release is gated until every
  // conflicting part is reviewed — defaults are pre-selected, so this is
  // "review & confirm", not busywork.
  const [resolvedParts, setResolvedParts] = useState<Set<string>>(new Set());
  const [openPartId, setOpenPartId] = useState<string | null>(null);

  const resolutions = useMemo<ChangeOrderMergeResolution[]>(
    () =>
      conflicts.flatMap((c) =>
        c.entries.map((e) => ({
          affectedItemId: c.affectedItemId,
          kind: e.kind,
          draftId: e.draftId,
          liveId: e.liveId,
          choice: choices[stateKey(c.affectedItemId, e)] ?? e.defaultChoice
        }))
      ),
    [conflicts, choices]
  );

  if (status !== "Implementation") return null;

  const hasConflicts = conflicts.length > 0;
  const isSubmitting = fetcher.state !== "idle";
  const allResolved = conflicts.every((c) =>
    resolvedParts.has(c.affectedItemId)
  );
  const openConflict =
    conflicts.find((c) => c.affectedItemId === openPartId) ?? null;

  const partLabel = (c: ChangeOrderReleaseConflict) =>
    getItemReadableId(items, c.itemId) ?? c.itemId;

  // Slice the master choice map down to the open part, keyed by the line-local
  // entry key the resolver expects.
  const openChoices: Record<string, ChangeOrderMergeChoice> = {};
  if (openConflict) {
    for (const e of openConflict.entries) {
      openChoices[changeOrderMergeEntryKey(e)] =
        choices[stateKey(openConflict.affectedItemId, e)] ?? e.defaultChoice;
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Release</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {hasConflicts ? (
            <Trans>
              Resolve each part's conflicts below, then release. This activates
              every affected item's method.
            </Trans>
          ) : (
            <Trans>Release the change order to activate the changes.</Trans>
          )}
        </span>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {hasConflicts && (
            <Alert variant="warning">
              <LuTriangleAlert className="size-4" />
              <AlertTitle>
                <Trans>The live method changed since you started</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  Another change order released a newer version of{" "}
                  {conflicts.length === 1
                    ? t`this part`
                    : t`${conflicts.length} of these parts`}
                  . Resolve each one to choose which changes to keep before
                  releasing.
                </Trans>
              </AlertDescription>
            </Alert>
          )}

          {conflicts.map((c) => {
            const isResolved = resolvedParts.has(c.affectedItemId);
            return (
              <HStack
                key={c.affectedItemId}
                className="w-full justify-between gap-3 rounded-xl border border-border p-3"
              >
                <VStack spacing={0}>
                  <span className="text-sm font-medium text-foreground">
                    {partLabel(c)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <Trans>{c.entries.length} conflicting change(s)</Trans>
                  </span>
                </VStack>
                <HStack spacing={2}>
                  {isResolved ? (
                    <Badge variant="green">
                      <LuCircleCheck className="mr-1 size-3" />
                      <Trans>Resolved</Trans>
                    </Badge>
                  ) : (
                    <Badge variant="yellow">
                      <Trans>Review required</Trans>
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant={isResolved ? "secondary" : "primary"}
                    leftIcon={<LuGitMerge />}
                    onClick={() => setOpenPartId(c.affectedItemId)}
                  >
                    {isResolved ? t`Review` : t`Resolve`}
                  </Button>
                </HStack>
              </HStack>
            );
          })}

          <fetcher.Form
            method="post"
            action={path.to.changeOrderStatus(changeOrderId)}
          >
            <input type="hidden" name="id" value={changeOrderId} />
            <input type="hidden" name="fromStatus" value="Implementation" />
            <input type="hidden" name="status" value="Done" />
            <input type="hidden" name="mergeAcknowledged" value="true" />
            <input
              type="hidden"
              name="resolutions"
              value={JSON.stringify(resolutions)}
            />
            <VStack spacing={1}>
              <Button
                type="submit"
                leftIcon={<LuCircleCheck />}
                variant="primary"
                isDisabled={isSubmitting || (hasConflicts && !allResolved)}
                isLoading={isSubmitting}
              >
                {hasConflicts ? t`Resolve & Release` : t`Release Change Order`}
              </Button>
              {hasConflicts && !allResolved && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Resolve every part above to release.</Trans>
                </span>
              )}
            </VStack>
          </fetcher.Form>
        </VStack>
      </CardContent>

      {openConflict && (
        <ChangeOrderConflictResolver
          open={openPartId !== null}
          partLabel={partLabel(openConflict)}
          conflict={openConflict}
          choices={openChoices}
          onChoice={(entryKey, choice) =>
            setChoices((p) => ({
              ...p,
              [`${openConflict.affectedItemId}:${entryKey}`]: choice
            }))
          }
          onSetAll={(choice) =>
            setChoices((p) => {
              const next = { ...p };
              for (const e of openConflict.entries) {
                next[stateKey(openConflict.affectedItemId, e)] = choice;
              }
              return next;
            })
          }
          onDone={() => {
            setResolvedParts((p) =>
              new Set(p).add(openConflict.affectedItemId)
            );
            setOpenPartId(null);
          }}
          onClose={() => setOpenPartId(null)}
        />
      )}
    </Card>
  );
}
