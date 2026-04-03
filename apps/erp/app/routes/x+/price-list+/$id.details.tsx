import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Error("Price list ID not found");
  return redirect(path.to.priceListItems(id));
}

export default function PriceListDetailsRedirect() {
  return null;
}
