import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

export function ItemWithRevision({
  item
}: {
  item?: {
    readableId?: string | null;
    revision?: string | null;
  } | null;
}) {
  if (!item) return null;
  const { readableId, revision } = item;
  if (!readableId) return null;
  return (
    <div className="flex items-center gap-1">
      <span>{readableId}</span>
      {revision && revision !== "0" && (
        <Badge variant="outline" className="font-mono">
          <Trans>Rev {revision}</Trans>
        </Badge>
      )}
    </div>
  );
}
