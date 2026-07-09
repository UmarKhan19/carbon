import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  AbilityForm,
  abilityValidator,
  insertAbility
} from "~/modules/resources";
import { path } from "~/utils/path";

function buildCurve(weeks: number, startingPoint: number) {
  const range = 100 - startingPoint;
  const data = [
    { id: 0, week: 0, value: startingPoint },
    {
      id: 1,
      week: Math.round(((weeks * 1) / 3) * 100) / 100,
      value: Math.round(startingPoint + range * 0.6)
    },
    {
      id: 2,
      week: Math.round(((weeks * 2) / 3) * 100) / 100,
      value: Math.round(startingPoint + range * 0.8)
    },
    { id: 3, week: weeks, value: 100 }
  ];
  return { data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(abilityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, startingPoint, weeks, shadowWeeks, recertifyEveryDays } =
    validation.data;

  const createAbility = await insertAbility(client, {
    name,
    curve: buildCurve(weeks, startingPoint),
    shadowWeeks,
    recertifyEveryDays: recertifyEveryDays ?? null,
    companyId,
    createdBy: userId
  });
  if (createAbility.error) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(createAbility.error, "Failed to create ability")
      )
    );
  }

  throw redirect(
    path.to.abilities,
    await flash(request, success("Created ability"))
  );
}

export default function NewAbilityRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.abilities);

  const initialValues = {
    name: "",
    startingPoint: 50,
    weeks: 4,
    shadowWeeks: 0,
    recertifyEveryDays: undefined as number | undefined
  };

  return <AbilityForm onClose={onClose} initialValues={initialValues} />;
}
