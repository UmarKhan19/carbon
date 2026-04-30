import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";

export function useSupplierApprovalRequired(): boolean {
  const routeData = useRouteData<{ supplierApprovalRequired: boolean }>(
    path.to.authenticatedRoot
  );
  return routeData?.supplierApprovalRequired ?? false;
}
