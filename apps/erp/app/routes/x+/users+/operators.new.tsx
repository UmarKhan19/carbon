import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useMount,
  VStack
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { Input, Location, Select, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import { createOperatorValidator } from "~/modules/users/users.models";
import type { getEmployeeTypes } from "~/modules/users/users.service";
import { createConsoleOperator } from "~/modules/users/users.server";
import type { Result } from "~/types";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "users" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(createOperatorValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, employeeType, locationId, pin } =
    validation.data;

  const result = await createConsoleOperator(client, {
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
    createdBy: userId
  });

  if (!result.success) {
    throw redirect(
      path.to.operators,
      await flash(
        request,
        error(result, result.message ?? "Failed to create console operator")
      )
    );
  }

  // Set PIN if provided (employee record is already created by createConsoleOperator)
  if (pin) {
    const { getCarbonServiceRole } = await import("@carbon/auth");
    const serviceRole = getCarbonServiceRole();
    const pinUpdate = await serviceRole
      .from("employee")
      .update({ pin } as any)
      .eq("id", result.userId)
      .eq("companyId", companyId);

    if (pinUpdate.error) {
      console.error("Failed to set PIN for operator:", pinUpdate.error);
    }
  }

  throw redirect(
    path.to.operators,
    await flash(request, success("Console operator created successfully"))
  );
}

export default function NewOperatorRoute() {
  const { defaults } = useUser();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const employeeTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getEmployeeTypes>>>();

  useMount(() => {
    employeeTypeFetcher.load(path.to.api.employeeTypes);
  });

  const employeeTypeOptions =
    employeeTypeFetcher.data?.data?.map((et) => ({
      value: et.id,
      label: et.name
    })) ?? [];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.newOperator}
          validator={createOperatorValidator}
          defaultValues={{
            locationId: defaults?.locationId ?? undefined
          }}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>Add Console Operator</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <Input name="firstName" label="First Name" />
                <Input name="lastName" label="Last Name" />
              </div>
              <Select
                name="employeeType"
                label="Employee Type"
                options={employeeTypeOptions}
                placeholder="Select Employee Type"
              />
              <Location name="locationId" label="Location" />
              <Input
                name="pin"
                label="PIN"
                placeholder="4-digit PIN"
                maxLength={4}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Console operators can pin in at shared MES terminals without
                needing an email or password. They can be converted to full
                users later.
              </p>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isLoading={formFetcher.state !== "idle"}>
                Create Operator
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
