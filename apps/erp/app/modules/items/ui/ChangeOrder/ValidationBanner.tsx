import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleAlert, LuTriangleAlert } from "react-icons/lu";

// Blocks (or warns about) release. `errors` hard-block the release, `warnings`
// are advisory. Renders nothing when both are empty.
export default function ValidationBanner({
  errors = [],
  warnings = []
}: {
  errors?: string[];
  warnings?: string[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;

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
              {errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
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
              {warnings.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
