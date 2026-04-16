import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { productionEventValidator } from "~/services/models";
import {
  endProductionEvent,
  getJobOperationForCompany,
  getProductionEventForCompany,
  getTrackedEntitiesForCompany,
  startProductionEvent
} from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requireActiveEmployee(request);

  const formData = await request.formData();
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

  const authorizedOperation = await getJobOperationForCompany(
    client,
    d.jobOperationId,
    companyId
  );

  if (authorizedOperation.error || !authorizedOperation.data) {
    return data(
      {},
      await flash(request, error(authorizedOperation.error, "Access Denied"))
    );
  }

  if (productionAction === "Start") {
    if (trackedEntityId) {
      const trackedEntities = await getTrackedEntitiesForCompany(
        client,
        [trackedEntityId],
        companyId
      );

      if (trackedEntities.error || trackedEntities.data.length !== 1) {
        return data(
          {},
          await flash(request, error(trackedEntities.error, "Access Denied"))
        );
      }
    }

    const startEvent = await startProductionEvent(
      client,
      {
        ...d,
        jobOperationId: authorizedOperation.data.id,
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

    const authorizedEvent = await getProductionEventForCompany(
      client,
      id,
      companyId
    );

    if (
      authorizedEvent.error ||
      !authorizedEvent.data ||
      authorizedEvent.data.jobOperationId !== authorizedOperation.data.id
    ) {
      return data(
        {},
        await flash(request, error(authorizedEvent.error, "Access Denied"))
      );
    }

    const endEvent = await endProductionEvent(client, {
      id: authorizedEvent.data.id,
      endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId
    });
    if (endEvent.error) {
      return data(
        {},
        await flash(request, error(endEvent.error, "Failed to end event"))
      );
    }
    return data(
      endEvent.data,
      await flash(request, success(`Ended ${d.type.toLowerCase()} operation`))
    );
  }
}
