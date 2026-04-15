import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Redirect old nested route to the new top-level price-list route
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${path.to.salesPriceList}${url.search}`);
}
