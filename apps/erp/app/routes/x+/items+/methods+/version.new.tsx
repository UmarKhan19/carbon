import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  copyMakeMethod,
  getOpenChangeOrderForPendingRevision,
  makeMethodVersionValidator,
  upsertMakeMethodVersion
} from "~/modules/items";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(makeMethodVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // ECO governance: a proposed (draft) revision must carry a single make-method
  // that release promotes. Adding versions to it would make release's
  // "Draft → Active" promotion ambiguous, so block new versions while an open
  // change order owns the revision (mirrors the activate-version gate).
  const source = await client
    .from("makeMethod")
    .select("itemId")
    .eq("id", validation.data.copyFromId)
    .eq("companyId", companyId)
    .single();
  if (source.data?.itemId) {
    const openCO = await getOpenChangeOrderForPendingRevision(client, {
      pendingItemId: source.data.itemId,
      companyId
    });
    if (openCO.data) {
      return data(
        { id: null },
        await flash(
          request,
          error(
            openCO,
            `This revision is proposed under change order ${openCO.data.changeOrderId}. Add new versions after it is released.`
          )
        )
      );
    }
  }

  const insertMethodOperation = await upsertMakeMethodVersion(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insertMethodOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodOperation.error, "Failed to insert new version")
      )
    );
  }

  const methodOperationId = insertMethodOperation.data?.id;
  const itemId = insertMethodOperation.data?.itemId;
  const itemType = insertMethodOperation.data?.type;
  if (!methodOperationId || !itemType) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertMethodOperation, "Failed to insert new version")
      )
    );
  }

  // @ts-expect-error TS2345 - TODO: fix type
  const copy = await copyMakeMethod(getCarbonServiceRole(), {
    sourceId: validation.data.copyFromId,
    targetId: methodOperationId,
    companyId,
    userId
  });

  if (copy.error) {
    return {
      success: false,
      message: "Failed to copy make method"
    };
  }

  // @ts-expect-error
  throw redirect(getPathToMakeMethod(itemType, itemId, methodOperationId));
}
