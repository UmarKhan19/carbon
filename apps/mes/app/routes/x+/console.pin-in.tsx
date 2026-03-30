import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { setConsolePinIn } from "~/services/console.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const userId = formData.get("userId") as string;
  const name = formData.get("name") as string;
  const avatarUrl = (formData.get("avatarUrl") as string) || null;
  const pin = (formData.get("pin") as string) || null;

  if (!userId || !name) {
    return data({ error: "userId and name are required" }, { status: 400 });
  }

  const serviceRole = await getCarbonServiceRole();

  // Validate user exists and is active
  const userCheck = await serviceRole
    .from("user")
    .select("id, active")
    .eq("id", userId)
    .single();

  if (userCheck.error || !userCheck.data?.active) {
    return data({ error: "User not found or inactive" }, { status: 400 });
  }

  const employeeCheck = await serviceRole
    .from("employee")
    .select("*")
    .eq("id", userId)
    .eq("companyId", companyId)
    .single();

  if (employeeCheck.error || !employeeCheck.data) {
    return data(
      { error: "Employee not found in this company" },
      { status: 400 }
    );
  }

  const storedPin: string | null = (employeeCheck.data as any)?.pin ?? null;

  if (!storedPin) {
    return data(
      {
        error: "No PIN set. Please set a PIN in your account settings."
      },
      { status: 400 }
    );
  }

  if (!pin || pin !== storedPin) {
    return data({ error: "Incorrect PIN" }, { status: 400 });
  }

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": setConsolePinIn(companyId, {
        userId,
        name,
        avatarUrl,
        pinnedAt: Date.now()
      })
    }
  });
}
