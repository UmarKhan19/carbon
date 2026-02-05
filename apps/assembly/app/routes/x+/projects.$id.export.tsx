import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export function loader({ params }: LoaderFunctionArgs) {
  return redirect(path.to.projectEdit(params.id!));
}
