import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation
} from "react-router";
import { Combobox, DatePicker, Input } from "~/components/Form";
import { pickingListValidator } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "inventory" });
  const url = new URL(request.url);
  return {
    defaultJobId: url.searchParams.get("jobId") ?? undefined,
    defaultLocationId: url.searchParams.get("locationId") ?? undefined,
    returnTo: url.searchParams.get("returnTo") ?? undefined
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(pickingListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId, locationId, dueDate, destinationStorageUnitId } =
    validation.data;

  if (!jobId || !locationId) {
    return data(
      { formError: "Job and location are required" },
      await flash(request, error(null, "Job and location are required"))
    );
  }

  const { data: pickResult, error: fnError } = await client.functions.invoke(
    "pick",
    {
      body: JSON.stringify({
        type: "generatePickingList",
        jobId,
        locationId,
        destinationStorageUnitId,
        dueDate,
        companyId,
        userId
      })
    }
  );

  if (fnError || !pickResult?.id) {
    let backendError =
      pickResult &&
      typeof pickResult === "object" &&
      "error" in pickResult &&
      typeof (pickResult as { error?: unknown }).error === "string"
        ? (pickResult as { error: string }).error
        : null;

    if (
      !backendError &&
      fnError &&
      typeof fnError === "object" &&
      "context" in fnError
    ) {
      const context = (
        fnError as {
          context?: {
            json?: () => Promise<unknown>;
            text?: () => Promise<string>;
          };
        }
      ).context;
      if (context?.json) {
        const body = await context.json().catch(() => null);
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          backendError = (body as { error: string }).error;
        }
      } else if (context?.text) {
        backendError = await context.text().catch(() => null);
      }
    }

    const message =
      backendError ??
      (fnError?.message === "Edge Function returned a non-2xx status code"
        ? "Failed to create picking list"
        : fnError?.message) ??
      "Failed to create picking list";

    return data(
      { formError: message },
      await flash(request, error(message, "Failed to create picking list"))
    );
  }

  throw redirect(
    path.to.pickingList(pickResult.id),
    await flash(request, success("Picking list created"))
  );
}

function useJobOptions() {
  const fetcher = useFetcher<{ data: Array<{ id: string; jobId: string }> }>();
  useMount(() => fetcher.load(path.to.api.inventoryJobs));
  return useMemo(
    () =>
      (fetcher.data?.data ?? []).map((j) => ({ value: j.id, label: j.jobId })),
    [fetcher.data]
  );
}

function useLocationOptions() {
  const fetcher = useFetcher<{ data: Array<{ id: string; name: string }> }>();
  useMount(() => fetcher.load(path.to.api.locations));
  return useMemo(
    () =>
      (fetcher.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    [fetcher.data]
  );
}

export default function NewPickingListRoute() {
  const { defaultJobId, defaultLocationId, returnTo } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const onClose = () => navigate(returnTo ?? path.to.pickingLists);
  const isSubmitting = navigation.state === "submitting";

  const jobOptions = useJobOptions();
  const locationOptions = useLocationOptions();

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <ValidatedForm
          validator={pickingListValidator}
          method="post"
          defaultValues={{
            jobId: defaultJobId,
            locationId: defaultLocationId
          }}
          className="flex h-full flex-col"
        >
          <DrawerHeader>
            <DrawerTitle>
              <Trans>New Picking List</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Select a job and location to generate a picking list from its
                  bill of materials.
                </Trans>
              </p>

              {actionData?.formError ? (
                <p className="text-sm text-red-500">{actionData.formError}</p>
              ) : null}

              <Combobox name="jobId" label={t`Job`} options={jobOptions} />

              <Combobox
                name="locationId"
                label={t`Location`}
                options={locationOptions}
              />

              <DatePicker name="dueDate" label={t`Due Date`} isOptional />

              <Input
                name="destinationStorageUnitId"
                label={t`Destination Storage Unit ID`}
                isOptional
                placeholder="Paste storage unit id (xid)"
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              <Trans>Generate</Trans>
            </Button>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
