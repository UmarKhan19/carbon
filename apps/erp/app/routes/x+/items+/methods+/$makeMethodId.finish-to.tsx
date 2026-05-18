import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { path } from "~/utils/path";

const finishToValidator = z.object({
  finishToStorageUnitId: zfd.text(z.string().optional())
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { makeMethodId } = params;
  if (!makeMethodId) throw new Error("makeMethodId required");

  const formData = await request.formData();
  const validation = await validator(finishToValidator).validate(formData);

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Invalid form data"))
    );
  }

  const finishToStorageUnitId =
    validation.data.finishToStorageUnitId === undefined ||
    validation.data.finishToStorageUnitId === ""
      ? null
      : validation.data.finishToStorageUnitId;

  const { error: updateError } = await client
    .from("makeMethod")
    .update({ finishToStorageUnitId })
    .eq("id", makeMethodId)
    .eq("companyId", companyId);

  if (updateError) {
    return data(
      { success: false },
      await flash(
        request,
        error(updateError, "Failed to update finish-to storage unit")
      )
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? path.to.parts,
    await flash(request, success("Finish-to storage unit updated"))
  );
}
