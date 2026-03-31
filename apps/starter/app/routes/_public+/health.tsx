import { getCarbonServiceRole } from "@carbon/auth/client.server";

export async function loader() {
  try {
    const client = getCarbonServiceRole();
    const test = await client.from("attributeDataType").select("*");
    if (test.error !== null) throw test.error;
    return new Response("OK");
  } catch (error: unknown) {
    console.log("health ❌", { error });
    return new Response("ERROR", { status: 500 });
  }
}
