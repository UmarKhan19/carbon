import type { LoaderFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");
  return redirect(path.to.customerDetails(customerId));
}

export default function CustomerAccountingRoute() {
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  return null;
}
