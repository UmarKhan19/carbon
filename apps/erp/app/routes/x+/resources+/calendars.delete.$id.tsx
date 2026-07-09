import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteResourceCalendar,
  getResourceCalendar
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid resource calendar id");

  const calendar = await getResourceCalendar(client, id);
  if (calendar.error) {
    throw redirect(
      path.to.resourceCalendars,
      await flash(request, error(calendar.error, "Failed to get calendar"))
    );
  }

  return {
    calendar: calendar.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.resourceCalendars,
      await flash(request, error(params, "Failed to get a calendar id"))
    );
  }

  const deactivateCalendar = await deleteResourceCalendar(client, id);
  if (deactivateCalendar.error) {
    throw redirect(
      path.to.resourceCalendars,
      await flash(
        request,
        error(deactivateCalendar.error, "Failed to deactivate calendar")
      )
    );
  }

  throw redirect(
    path.to.resourceCalendars,
    await flash(request, success("Successfully deactivated calendar"))
  );
}

export default function DeleteResourceCalendarRoute() {
  const { id } = useParams();
  const { calendar } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!calendar) return null;
  if (!id) throw new Error("id is not found");

  const onCancel = () => navigate(path.to.resourceCalendars);
  const name = calendar.name;

  return (
    <ConfirmDelete
      action={path.to.deleteResourceCalendar(id)}
      name={name}
      text={t`Are you sure you want to deactivate the calendar: ${name}?`}
      onCancel={onCancel}
    />
  );
}
