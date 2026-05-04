import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { loadRulesTabData } from "~/modules/items/itemRules.server";
import ItemRuleAssignments from "~/modules/items/ui/ItemRules/ItemRuleAssignments";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { itemId } = params;
  if (!itemId) throw new Error("itemId required");
  return loadRulesTabData({ request, itemId });
}

export default function PartRulesRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId required");
  const { assignments, library } = useLoaderData<typeof loader>();
  return (
    <ItemRuleAssignments
      itemId={itemId}
      assignments={assignments as never}
      library={library as never}
    />
  );
}
