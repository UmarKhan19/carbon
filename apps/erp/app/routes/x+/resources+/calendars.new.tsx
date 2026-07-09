import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  ResourceCalendarForm,
  resourceCalendarValidator,
  upsertResourceCalendar
} from "~/modules/resources";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(resourceCalendarValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id, ...d } = validation.data;

  const createCalendar = await upsertResourceCalendar(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (createCalendar.error) {
    throw redirect(
      path.to.resourceCalendars,
      await flash(
        request,
        error(createCalendar.error, "Failed to create calendar")
      )
    );
  }

  throw redirect(
    path.to.resourceCalendars,
    await flash(request, success("Created calendar"))
  );
}

export default function NewResourceCalendarRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.resourceCalendars);

  const initialValues = {
    name: "",
    locationId: undefined as string | undefined
  };

  return (
    <ResourceCalendarForm onClose={onClose} initialValues={initialValues} />
  );
}
