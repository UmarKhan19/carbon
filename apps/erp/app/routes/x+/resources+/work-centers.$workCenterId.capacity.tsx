import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { DatePicker, Hidden, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  deleteWorkCenterCapacity,
  getWorkCenter,
  getWorkCenterCapacities,
  upsertWorkCenterCapacity,
  workCenterCapacityValidator
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId not found");

  const [workCenter, capacities] = await Promise.all([
    getWorkCenter(client, workCenterId),
    getWorkCenterCapacities(client, workCenterId)
  ]);

  if (workCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(workCenter.error, "Failed to fetch work center")
      )
    );
  }

  return {
    workCenterName: workCenter.data?.name ?? "",
    capacities: capacities.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete-capacity") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return data(
        {},
        await flash(request, error(null, "Invalid capacity override"))
      );
    }

    const removeCapacity = await deleteWorkCenterCapacity(client, id);
    if (removeCapacity.error) {
      return data(
        {},
        await flash(
          request,
          error(removeCapacity.error, "Failed to delete capacity override")
        )
      );
    }

    return data({}, await flash(request, success("Deleted capacity override")));
  }

  if (intent === "upsert-capacity") {
    const validation = await validator(workCenterCapacityValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { id, ...d } = validation.data;

    const existing = await getWorkCenterCapacities(client, workCenterId);
    if (existing.error) {
      return data(
        {},
        await flash(
          request,
          error(existing.error, "Failed to fetch capacity overrides")
        )
      );
    }

    // Overlap guard: the new range [effectiveFrom, effectiveTo ?? infinity)
    // must not intersect an existing row (excluding the row being edited)
    const newFrom = d.effectiveFrom;
    const newTo = d.effectiveTo ?? null;
    const overlaps = (existing.data ?? []).some((row) => {
      if (id && row.id === id) return false;
      const rowTo = row.effectiveTo ?? null;
      return (
        (rowTo === null || newFrom < rowTo) &&
        (newTo === null || row.effectiveFrom < newTo)
      );
    });

    if (overlaps) {
      return data(
        {},
        await flash(
          request,
          error(null, "Overlaps an existing capacity override")
        )
      );
    }

    const upsertCapacity = await upsertWorkCenterCapacity(
      client,
      id
        ? {
            id,
            ...d,
            updatedBy: userId
          }
        : {
            ...d,
            companyId,
            createdBy: userId
          }
    );
    if (upsertCapacity.error) {
      return data(
        {},
        await flash(
          request,
          error(upsertCapacity.error, "Failed to save capacity override")
        )
      );
    }

    return data({}, await flash(request, success("Saved capacity override")));
  }

  return data({}, await flash(request, error(null, "Invalid intent")));
}

export default function WorkCenterCapacityRoute() {
  const { workCenterName, capacities } = useLoaderData<typeof loader>();
  const { workCenterId } = useParams();
  if (!workCenterId) throw new Error("workCenterId not found");

  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const upsertFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();

  const [selectedCapacity, setSelectedCapacity] = useState<
    (typeof capacities)[number] | null
  >(null);

  const isDisabled = !permissions.can("update", "resources");

  const onClose = () => navigate(path.to.workCenters);

  const initialValues = {
    id: selectedCapacity?.id,
    workCenterId,
    effectiveFrom: selectedCapacity?.effectiveFrom ?? "",
    effectiveTo: selectedCapacity?.effectiveTo ?? undefined,
    parallelCapacity: selectedCapacity?.parallelCapacity ?? 1
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <ModalDrawerContent>
          <div className="flex flex-col h-full">
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Capacity Overrides: {workCenterName}</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={8}>
                <VStack spacing={2} className="w-full">
                  {capacities.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      <Trans>No capacity overrides defined</Trans>
                    </p>
                  )}
                  {capacities.map((capacity) => (
                    <div
                      key={capacity.id}
                      className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span className="text-sm">
                        {formatDate(capacity.effectiveFrom)} –{" "}
                        {capacity.effectiveTo ? (
                          formatDate(capacity.effectiveTo)
                        ) : (
                          <Trans>open-ended</Trans>
                        )}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {capacity.parallelCapacity}
                      </span>
                      <HStack spacing={1}>
                        <IconButton
                          aria-label={t`Edit capacity override`}
                          icon={<LuPencil />}
                          variant="ghost"
                          isDisabled={isDisabled}
                          onClick={() => setSelectedCapacity(capacity)}
                        />
                        <deleteFetcher.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="delete-capacity"
                          />
                          <input type="hidden" name="id" value={capacity.id} />
                          <IconButton
                            type="submit"
                            aria-label={t`Delete capacity override`}
                            icon={<LuTrash />}
                            variant="ghost"
                            isDisabled={isDisabled}
                          />
                        </deleteFetcher.Form>
                      </HStack>
                    </div>
                  ))}
                </VStack>
                <ValidatedForm
                  key={selectedCapacity?.id ?? "new"}
                  validator={workCenterCapacityValidator}
                  method="post"
                  fetcher={upsertFetcher}
                  resetAfterSubmit
                  defaultValues={initialValues}
                  className="w-full rounded-md border p-3"
                >
                  <Hidden name="intent" value="upsert-capacity" />
                  <Hidden name="id" />
                  <Hidden name="workCenterId" />
                  <VStack spacing={2}>
                    <DatePicker
                      name="effectiveFrom"
                      label={t`Effective From`}
                    />
                    <DatePicker name="effectiveTo" label={t`Effective To`} />
                    <Number
                      name="parallelCapacity"
                      label={t`Parallel Capacity`}
                      minValue={0}
                    />
                    <HStack>
                      <Submit
                        variant="secondary"
                        withBlocker={false}
                        isDisabled={isDisabled}
                      >
                        {selectedCapacity ? (
                          <Trans>Update Override</Trans>
                        ) : (
                          <Trans>Add Override</Trans>
                        )}
                      </Submit>
                      {selectedCapacity && (
                        <Button
                          variant="ghost"
                          onClick={() => setSelectedCapacity(null)}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      )}
                    </HStack>
                  </VStack>
                </ValidatedForm>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Close</Trans>
              </Button>
            </ModalDrawerFooter>
          </div>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
