import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleAlert, LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import type { ChangeOrderValidationEntry } from "~/modules/items/changeOrder.server";
import { path } from "~/utils/path";

// Blocks (or warns about) release. `errors` hard-block the release, `warnings`
// are advisory. Entries tied to an affected item (coItemId) link straight to
// that item's disposition/redline view so the fix is one click away. Renders
// nothing when both are empty.
export default function ValidationBanner({
  changeOrderId,
  errors = [],
  warnings = []
}: {
  changeOrderId: string;
  errors?: ChangeOrderValidationEntry[];
  warnings?: ChangeOrderValidationEntry[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;

  const renderEntry = (entry: ChangeOrderValidationEntry, index: number) => (
    <li key={index}>
      {entry.coItemId ? (
        <Link
          to={path.to.changeOrderItem(changeOrderId, entry.coItemId)}
          className="underline underline-offset-2 hover:opacity-80"
        >
          {entry.message}
        </Link>
      ) : (
        entry.message
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-3 w-full">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <LuCircleAlert className="size-4" />
          <AlertTitle>
            <Trans>Release blocked</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {errors.map(renderEntry)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert className="size-4" />
          <AlertTitle>
            <Trans>Warnings</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {warnings.map(renderEntry)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
