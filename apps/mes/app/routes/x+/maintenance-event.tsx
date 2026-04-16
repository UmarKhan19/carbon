import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  endMaintenanceEvent,
  getMaintenanceDispatchForCompany,
  getMaintenanceEventForCompany,
  startMaintenanceEvent,
  updateMaintenanceDispatchStatus
} from "~/services/maintenance.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requireActiveEmployee(request);

  const formData = await request.formData();
  const action = formData.get("action") as "Start" | "End" | "Complete";
  const dispatchId = formData.get("dispatchId") as string;
  const workCenterId = formData.get("workCenterId") as string;
  const eventId = formData.get("eventId") as string | undefined;

  if (!dispatchId) {
    return data({}, await flash(request, error("Dispatch ID is required")));
  }

  const serviceRole = await getCarbonServiceRole();
  const currentTime = now(getLocalTimeZone()).toAbsoluteString();
  const dispatch = await getMaintenanceDispatchForCompany(
    serviceRole,
    dispatchId,
    companyId
  );

  if (dispatch.error || !dispatch.data) {
    return data(
      {},
      await flash(request, error(dispatch.error, "Access Denied"))
    );
  }

  if (action === "Start") {
    // Start a new maintenance event
    const startEvent = await startMaintenanceEvent(serviceRole, {
      maintenanceDispatchId: dispatch.data.id,
      employeeId: userId,
      workCenterId: dispatch.data.workCenterId ?? workCenterId,
      startTime: currentTime,
      companyId,
      createdBy: userId
    });

    if (startEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(startEvent.error, "Failed to start maintenance event")
        )
      );
    }

    // Update dispatch status to In Progress
    await updateMaintenanceDispatchStatus(serviceRole, {
      dispatchId: dispatch.data.id,
      status: "In Progress",
      actualStartTime: currentTime,
      updatedBy: userId
    });

    return data(
      { eventId: startEvent.data?.id },
      await flash(request, success("Maintenance started"))
    );
  }

  if (action === "End") {
    if (!eventId) {
      return data(
        {},
        await flash(request, error("Event ID is required to end"))
      );
    }

    const event = await getMaintenanceEventForCompany(
      serviceRole,
      eventId,
      companyId
    );

    if (
      event.error ||
      !event.data ||
      event.data.maintenanceDispatchId !== dispatch.data.id
    ) {
      return data(
        {},
        await flash(request, error(event.error, "Access Denied"))
      );
    }

    const endEvent = await endMaintenanceEvent(serviceRole, {
      eventId: event.data.id,
      endTime: currentTime,
      updatedBy: userId
    });

    if (endEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(endEvent.error, "Failed to end maintenance event")
        )
      );
    }

    return data({}, await flash(request, success("Maintenance paused")));
  }

  if (action === "Complete") {
    // End any active event first
    if (eventId) {
      const event = await getMaintenanceEventForCompany(
        serviceRole,
        eventId,
        companyId
      );

      if (
        !event.error &&
        event.data &&
        event.data.maintenanceDispatchId === dispatch.data.id
      ) {
        await endMaintenanceEvent(serviceRole, {
          eventId: event.data.id,
          endTime: currentTime,
          updatedBy: userId
        });
      }
    }

    // Update dispatch status to Completed
    const updateStatus = await updateMaintenanceDispatchStatus(serviceRole, {
      dispatchId: dispatch.data.id,
      status: "Completed",
      actualEndTime: currentTime,
      completedAt: currentTime,
      updatedBy: userId
    });

    if (updateStatus.error) {
      return data(
        {},
        await flash(
          request,
          error(updateStatus.error, "Failed to complete maintenance")
        )
      );
    }

    throw redirect(
      path.to.maintenance,
      await flash(request, success("Maintenance completed"))
    );
  }

  return data({});
}
