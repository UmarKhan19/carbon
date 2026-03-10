import type { LoaderFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");
  return redirect(path.to.supplierDetails(supplierId));
}

export default function SupplierAccountingRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  return null;
}
