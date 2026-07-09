import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { getAccount } from "~/modules/account";
import { ProfileForm } from "~/modules/account/ui/Profile";
import { PersonAbilities } from "~/modules/people/ui/Person";
import { getEmployeeAbilities } from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [account, employeeAbilities] = await Promise.all([
    getAccount(client, personId),
    getEmployeeAbilities(client, personId, companyId)
  ]);

  if (account.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return {
    user: account.data,
    abilities: employeeAbilities.data ?? []
  };
}

export default function PersonProfileRoute() {
  const { user, abilities } = useLoaderData<typeof loader>();
  const { personId } = useParams();
  if (!personId) throw new Error("Could not find personId");

  return (
    <VStack spacing={4}>
      <ProfileForm user={user} />
      <PersonAbilities personId={personId} abilities={abilities} />
    </VStack>
  );
}
