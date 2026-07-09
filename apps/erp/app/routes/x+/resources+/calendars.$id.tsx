import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  deleteResourceCalendarException,
  deleteResourceCalendarShift,
  getResourceCalendar,
  getResourceCalendarExceptions,
  getResourceCalendarShifts,
  ResourceCalendarForm,
  resourceCalendarExceptionValidator,
  resourceCalendarShiftValidator,
  resourceCalendarValidator,
  upsertResourceCalendar,
  upsertResourceCalendarException,
  upsertResourceCalendarShift
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid resource calendar id");

  const [calendar, shifts, exceptions] = await Promise.all([
    getResourceCalendar(client, id),
    getResourceCalendarShifts(client, id),
    getResourceCalendarExceptions(client, id)
  ]);

  if (calendar.error) {
    throw redirect(
      path.to.resourceCalendars,
      await flash(request, error(calendar.error, "Failed to fetch calendar"))
    );
  }

  return {
    calendar: calendar.data,
    shifts: shifts.data ?? [],
    exceptions: exceptions.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { id: calendarId } = params;
  if (!calendarId) throw notFound("Invalid resource calendar id");

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "calendar");

  switch (intent) {
    case "upsert-shift": {
      const validation = await validator(
        resourceCalendarShiftValidator
      ).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }

      const { id, ...d } = validation.data;
      const upsertShift = id
        ? await upsertResourceCalendarShift(client, {
            id,
            ...d,
            updatedBy: userId
          })
        : await upsertResourceCalendarShift(client, {
            ...d,
            companyId,
            createdBy: userId
          });
      if (upsertShift.error) {
        return data(
          {},
          await flash(request, error(upsertShift.error, "Failed to save shift"))
        );
      }

      return data({}, await flash(request, success("Saved shift")));
    }
    case "delete-shift": {
      const id = formData.get("id");
      if (typeof id !== "string" || !id) {
        return data(
          {},
          await flash(request, error(null, "Failed to get shift id"))
        );
      }

      const deleteShift = await deleteResourceCalendarShift(client, id);
      if (deleteShift.error) {
        return data(
          {},
          await flash(
            request,
            error(deleteShift.error, "Failed to delete shift")
          )
        );
      }

      return data({}, await flash(request, success("Deleted shift")));
    }
    case "upsert-exception": {
      const validation = await validator(
        resourceCalendarExceptionValidator
      ).validate(formData);
      if (validation.error) {
        return validationError(validation.error);
      }

      const { id, ...d } = validation.data;
      const upsertException = id
        ? await upsertResourceCalendarException(client, {
            id,
            ...d,
            updatedBy: userId
          })
        : await upsertResourceCalendarException(client, {
            ...d,
            companyId,
            createdBy: userId
          });
      if (upsertException.error) {
        return data(
          {},
          await flash(
            request,
            error(upsertException.error, "Failed to save exception")
          )
        );
      }

      return data({}, await flash(request, success("Saved exception")));
    }
    case "delete-exception": {
      const id = formData.get("id");
      if (typeof id !== "string" || !id) {
        return data(
          {},
          await flash(request, error(null, "Failed to get exception id"))
        );
      }

      const deleteException = await deleteResourceCalendarException(client, id);
      if (deleteException.error) {
        return data(
          {},
          await flash(
            request,
            error(deleteException.error, "Failed to delete exception")
          )
        );
      }

      return data({}, await flash(request, success("Deleted exception")));
    }
    default: {
      const validation = await validator(resourceCalendarValidator).validate(
        formData
      );
      if (validation.error) {
        return validationError(validation.error);
      }

      const { id, ...d } = validation.data;
      if (!id) throw new Error("ID was not found");

      const updateCalendar = await upsertResourceCalendar(client, {
        id,
        ...d,
        updatedBy: userId,
        customFields: setCustomFields(formData)
      });
      if (updateCalendar.error) {
        return data(
          {},
          await flash(
            request,
            error(updateCalendar.error, "Failed to update calendar")
          )
        );
      }

      throw redirect(
        path.to.resourceCalendars,
        await flash(request, success("Updated calendar"))
      );
    }
  }
}

export default function ResourceCalendarRoute() {
  const { calendar, shifts, exceptions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.resourceCalendars);

  const initialValues = {
    id: calendar?.id ?? undefined,
    name: calendar?.name ?? "",
    locationId: calendar?.locationId ?? undefined,
    ...getCustomFields(calendar?.customFields)
  };

  return (
    <ResourceCalendarForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
      shifts={shifts}
      exceptions={exceptions}
    />
  );
}
