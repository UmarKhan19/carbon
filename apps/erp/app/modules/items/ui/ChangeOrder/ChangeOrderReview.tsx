import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuArrowRight } from "react-icons/lu";
import { useItems } from "~/stores";
import type { ChangeOrderDiff } from "../../changeOrder.diff";
import type {
  MethodDiffEntry,
  MethodDiffStatus
} from "../../changeOrder.models";

type Row = Record<string, unknown>;
type Entry = MethodDiffEntry<Row>;

function StatusBadge({ status }: { status: MethodDiffStatus }) {
  if (status === "added")
    return (
      <Badge variant="green">
        <Trans>Added</Trans>
      </Badge>
    );
  if (status === "modified")
    return (
      <Badge variant="yellow">
        <Trans>Modified</Trans>
      </Badge>
    );
  if (status === "removed")
    return (
      <Badge variant="red">
        <Trans>Removed</Trans>
      </Badge>
    );
  return null;
}

// A read-only summary of every staged change per affected item — the "tips"
// panel shown from Implementation onward. Purely informational.
export default function ChangeOrderReview({ diff }: { diff: ChangeOrderDiff }) {
  const [items] = useItems();

  const hasAnyChange =
    diff.items.some(
      (item) =>
        item.materials.some((m) => m.status !== "unchanged") ||
        item.operations.some((o) => o.status !== "unchanged") ||
        item.attributes.some((a) => a.status !== "unchanged")
    ) || diff.supersessions.length > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Review</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          <Trans>A summary of every staged change in this change order.</Trans>
        </span>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {!hasAnyChange && (
            <span className="text-sm text-muted-foreground italic">
              <Trans>No changes staged yet.</Trans>
            </span>
          )}

          {diff.items.map((item) => {
            const materials = item.materials.filter(
              (m) => m.status !== "unchanged"
            );
            const operations = item.operations.filter(
              (o) => o.status !== "unchanged"
            );
            const attributes = item.attributes.filter(
              (a) => a.status !== "unchanged"
            );
            if (
              materials.length === 0 &&
              operations.length === 0 &&
              attributes.length === 0
            )
              return null;

            return (
              <VStack
                key={item.affectedItemId}
                spacing={2}
                className="w-full border-b border-border pb-3"
              >
                <span className="text-sm font-medium">
                  {getItemReadableId(items, item.itemId) ?? item.itemId}
                </span>

                {materials.length > 0 && (
                  <ChangeGroup title={<Trans>Materials</Trans>}>
                    {materials.map((entry, index) => (
                      <MaterialLine
                        key={`m-${index}`}
                        entry={entry}
                        items={items}
                      />
                    ))}
                  </ChangeGroup>
                )}

                {operations.length > 0 && (
                  <ChangeGroup title={<Trans>Operations</Trans>}>
                    {operations.map((entry, index) => (
                      <OperationLine key={`o-${index}`} entry={entry} />
                    ))}
                  </ChangeGroup>
                )}

                {attributes.length > 0 && (
                  <ChangeGroup title={<Trans>Attributes</Trans>}>
                    {attributes.map((entry, index) => (
                      <AttributeLine key={`a-${index}`} entry={entry} />
                    ))}
                  </ChangeGroup>
                )}
              </VStack>
            );
          })}

          {diff.supersessions.length > 0 && (
            <ChangeGroup title={<Trans>Supersessions</Trans>}>
              {diff.supersessions.map((supersession) => (
                <HStack key={supersession.id} spacing={2}>
                  <span className="text-sm">
                    {getItemReadableId(items, supersession.predecessorItemId) ??
                      supersession.predecessorItemId}
                  </span>
                  <LuArrowRight className="text-muted-foreground" />
                  <span className="text-sm">
                    {supersession.successorItemId
                      ? (getItemReadableId(
                          items,
                          supersession.successorItemId
                        ) ?? supersession.successorItemId)
                      : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {supersession.supersessionMode}
                  </span>
                </HStack>
              ))}
            </ChangeGroup>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ChangeGroup({
  title,
  children
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack spacing={1} className="w-full pl-2">
      <h4 className="text-xs text-muted-foreground uppercase tracking-wide">
        {title}
      </h4>
      {children}
    </VStack>
  );
}

function MaterialLine({
  entry,
  items
}: {
  entry: Entry;
  items: ReturnType<typeof useItems>[0];
}) {
  const row = (entry.after ?? entry.before) as { itemId?: string } | null;
  const itemId = row?.itemId ?? "";
  return (
    <HStack spacing={2}>
      <StatusBadge status={entry.status} />
      <span className="text-sm">
        {getItemReadableId(items, itemId) ?? itemId}
      </span>
      <ChangedFields entry={entry} />
    </HStack>
  );
}

function OperationLine({ entry }: { entry: Entry }) {
  const { t } = useLingui();
  const row = (entry.after ?? entry.before) as { description?: string } | null;
  return (
    <HStack spacing={2}>
      <StatusBadge status={entry.status} />
      <span className="text-sm">{row?.description || t`Operation`}</span>
      <ChangedFields entry={entry} />
    </HStack>
  );
}

function AttributeLine({ entry }: { entry: Entry }) {
  return (
    <HStack spacing={2}>
      <StatusBadge status={entry.status} />
      <ChangedFields entry={entry} />
    </HStack>
  );
}

function ChangedFields({ entry }: { entry: Entry }) {
  if (!entry.changedFields) return null;
  return (
    <HStack spacing={2} className="flex-wrap">
      {Object.entries(entry.changedFields).map(([field, change]) => (
        <span key={field} className="text-xs text-muted-foreground">
          {field}: {String(change.before ?? "—")} →{" "}
          {String(change.after ?? "—")}
        </span>
      ))}
    </HStack>
  );
}
