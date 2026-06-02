import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { getPickingList, getPickingListLines } from "~/modules/inventory";
import {
  getPickingList as getPickingListFn,
  pickingListValidator,
  upsertPickingList
} from "~/modules/inventory";
import {
  PickingListForm,
  PickingListLines
} from "~/modules/inventory/ui/PickingLists";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;

type PickingListLineData = NonNullable<
  Awaited<ReturnType<typeof getPickingListLines>>["data"]
>;

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Error("pickingListId not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const existing = await getPickingListFn(viewClient, pickingListId);
  if (existing.data?.status && !["Draft"].includes(existing.data.status)) {
    throw redirect(
      path.to.pickingList(pickingListId),
      await flash(
        request,
        error(null, "Cannot modify a locked picking list. Reopen it first.")
      )
    );
  }

  const formData = await request.formData();
  const validation = await validator(pickingListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, pickingListId: validatedPickingListId, ...d } = validation.data;
  if (!id) throw new Error("id not found");
  if (!validatedPickingListId) throw new Error("pickingListId not found");

  const updateResult = await upsertPickingList(client, {
    id,
    pickingListId: validatedPickingListId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateResult.error) {
    throw redirect(
      path.to.pickingList(pickingListId),
      await flash(
        request,
        error(updateResult.error, "Failed to update picking list")
      )
    );
  }

  throw redirect(
    path.to.pickingList(pickingListId),
    await flash(request, success("Updated picking list"))
  );
}

export default function PickingListDetailsRoute() {
  const { pickingListId } = useParams();
  if (!pickingListId) throw new Error("Could not find pickingListId");

  const routeData = useRouteData<{
    pickingList: PickingListData;
    pickingListLines: PickingListLineData;
  }>(path.to.pickingList(pickingListId));

  if (!routeData?.pickingList)
    throw new Error("Could not find picking list in routeData");

  const initialValues = {
    ...routeData.pickingList,
    pickingListId: routeData.pickingList.pickingListId ?? undefined,
    assignee: routeData.pickingList.assignee ?? undefined,
    dueDate: routeData.pickingList.dueDate ?? undefined,
    notes: routeData.pickingList.notes ?? undefined,
    ...getCustomFields(routeData.pickingList.customFields)
  };

  return (
    <>
      <PickingListForm
        key={initialValues.id}
        initialValues={initialValues}
        pickingList={routeData.pickingList}
      />

      <PickingListLines
        pickingListLines={routeData.pickingListLines}
        pickingListId={pickingListId}
        pickingList={routeData.pickingList}
      />
    </>
  );
}
