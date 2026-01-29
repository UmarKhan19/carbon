import { requireAuthSession } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  throw redirect(path.to.authenticatedRoot);
}

export default function IndexRoute() {
  return <p>Redirecting to dashboard...</p>;
}
