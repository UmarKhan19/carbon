import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getMyChangeOrderTasks } from "~/modules/items";
import MyChangeOrderTasks from "~/modules/items/ui/Item/MyChangeOrderTasks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`My Change Orders`,
  to: path.to.myChangeOrderTasks,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const tasks = await getMyChangeOrderTasks(client, { userId, companyId });

  if (tasks.error) {
    console.error(tasks.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(tasks.error, "Error loading your change order tasks")
      )
    );
  }

  return { tasks: tasks.data };
}

export default function MyChangeOrderTasksRoute() {
  const { tasks } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MyChangeOrderTasks tasks={tasks} />
    </VStack>
  );
}
