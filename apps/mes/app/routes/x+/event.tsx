import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  productionEventEditValidator,
  productionEventValidator
} from "~/services/models";
import {
  endProductionEvent,
  getActiveProductionEventForTimer,
  startProductionEvent,
  updateProductionEventTimes
} from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateEventTimes") {
    const validation = await validator(productionEventEditValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const update = await updateProductionEventTimes(client, {
      ...validation.data,
      companyId,
      updatedBy: userId
    });

    if (update.error) {
      const message = update.error.message ?? "Failed to update time entry";

      return data(
        { success: false, message },
        await flash(request, error(update.error, message))
      );
    }

    return data(
      { success: true, productionEvent: update.data },
      await flash(request, success("Time entry updated"))
    );
  }

  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id,
    action: productionAction,
    timezone,
    trackedEntityId,
    ...d
  } = validation.data;

  if (productionAction === "Start") {
    const activeEvent = await getActiveProductionEventForTimer(client, {
      jobOperationId: d.jobOperationId,
      type: d.type,
      workCenterId: d.workCenterId,
      employeeId: userId,
      companyId
    });

    if (activeEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(activeEvent.error, "Failed to check active event")
        )
      );
    }

    if (activeEvent.data) {
      return data(
        activeEvent.data,
        await flash(
          request,
          success(`${d.type.toLowerCase()} operation is already active`)
        )
      );
    }

    const startEvent = await startProductionEvent(
      client,
      {
        ...d,
        startTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
        employeeId: userId,
        companyId,
        createdBy: userId
      },
      trackedEntityId
    );

    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }

    return data(
      startEvent.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} operation`))
    );
  } else {
    if (!id) {
      return data({}, await flash(request, error("No event id provided")));
    }
    const endEvent = await endProductionEvent(client, {
      id,
      endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId
    });
    if (endEvent.error) {
      return data(
        {},
        await flash(request, error(endEvent.error, "Failed to end event"))
      );
    }
    if (endEvent.data && endEvent.data.length > 0) {
      const serviceRole = await getCarbonServiceRole();
      await serviceRole.functions.invoke("post-production-event", {
        body: {
          productionEventId: endEvent.data[0].id,
          userId,
          companyId
        }
      });
    }
    return data(
      endEvent.data,
      await flash(request, success(`Ended ${d.type.toLowerCase()} operation`))
    );
  }
}
