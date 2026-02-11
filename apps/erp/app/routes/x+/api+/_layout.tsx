import { redirect } from "react-router";

export async function loader() {
  // Redirect from the old protected x+ route to the new public docs+ route
  throw redirect("/docs/api/js/intro");
}
