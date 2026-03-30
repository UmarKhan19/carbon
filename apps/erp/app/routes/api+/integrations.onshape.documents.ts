import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const result = await getOnshapeClient(client, companyId, userId);

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  const onshapeClient = result.client;

  try {
    let limit = 20;
    let offset = 0;
    let allDocuments: Array<{ id: string; name: string }> = [];

    while (true) {
      // @ts-expect-error TS18047 - TODO: fix type
      const response = await onshapeClient.getDocuments(limit, offset);

      if (!response.items || response.items.length === 0) {
        break;
      }

      allDocuments.push(...response.items);

      if (response.items.length < limit) {
        break;
      }

      offset += limit;
    }

    return {
      data: { items: allDocuments },
      error: null
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get documents from Onshape"
    };
  }
}
