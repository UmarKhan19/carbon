import { getLinearClient } from "./lib/client";

export async function linearHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const linear = getLinearClient();
  return await linear.healthcheck(companyId);
}
