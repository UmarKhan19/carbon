import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { LuLock } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

export function PlanUpgradeBanner({
  feature,
  description
}: {
  feature: string;
  description: string;
}) {
  return (
    <div className="p-6">
      <Alert variant="warning">
        <LuLock className="h-4 w-4" />
        <AlertTitle>{feature} requires the Business plan and above.</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{description}</span>
          <Button asChild variant="primary" size="md" className="self-start">
            <Link to={path.to.billing}>Upgrade plan</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
