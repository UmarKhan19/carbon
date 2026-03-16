import { requirePermissions } from "@carbon/auth/auth.server";
import { getDocuSignInstallUrl } from "@carbon/ee/docusign.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const url = getDocuSignInstallUrl({
    companyId,
    userId
  });

  return { url };
}
