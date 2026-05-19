import { notFound } from "@carbon/auth";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { paymentId } = params;
  if (!paymentId) throw notFound("Could not find paymentId");
  throw redirect(path.to.payment(paymentId));
}
