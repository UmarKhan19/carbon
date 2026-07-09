import { ValidatedForm } from "@carbon/form";
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
import { formatDateTime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  DateTimePicker,
  Hidden,
  Input,
  Location,
  Number,
  Select,
  Submit,
  TimePicker
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  resourceCalendarExceptionValidator,
  resourceCalendarShiftValidator,
  resourceCalendarValidator
} from "../../resources.models";
import type {
  ResourceCalendarException,
  ResourceCalendarShift
} from "../../types";

type ResourceCalendarFormProps = {
  initialValues: z.infer<typeof resourceCalendarValidator>;
  shifts?: ResourceCalendarShift[];
  exceptions?: ResourceCalendarException[];
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const formId = "resource-calendar-form";

const ResourceCalendarForm = ({
  initialValues,
  shifts = [],
  exceptions = [],
  type = "drawer",
  open = true,
  onClose
}: ResourceCalendarFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <div className="flex flex-col h-full">
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Calendar</Trans>
                ) : (
                  <Trans>New Calendar</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={8}>
                <ValidatedForm
                  id={formId}
                  validator={resourceCalendarValidator}
                  method="post"
                  action={
                    isEditing
                      ? path.to.resourceCalendar(initialValues.id!)
                      : path.to.newResourceCalendar
                  }
                  defaultValues={initialValues}
                  fetcher={fetcher}
                  className="w-full"
                >
                  <Hidden name="id" />
                  <Hidden name="intent" value="calendar" />
                  <VStack spacing={4}>
                    <Input name="name" label={t`Name`} />
                    <Location
                      name="locationId"
                      label={t`Location`}
                      isClearable
                    />
                    <CustomFormFields table="resourceCalendar" />
                  </VStack>
                </ValidatedForm>
                {isEditing && (
                  <>
                    <WeeklyPatternSection
                      calendarId={initialValues.id!}
                      shifts={shifts}
                      isDisabled={!permissions.can("update", "resources")}
                    />
                    <ExceptionsSection
                      calendarId={initialValues.id!}
                      exceptions={exceptions}
                      isDisabled={!permissions.can("update", "resources")}
                    />
                  </>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit formId={formId} isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </div>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

function WeeklyPatternSection({
  calendarId,
  shifts,
  isDisabled
}: {
  calendarId: string;
  shifts: ResourceCalendarShift[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const addFetcher = useFetcher<{}>();
  const deleteFetcher = useFetcher<{}>();

  const dayNames = [
    t`Sunday`,
    t`Monday`,
    t`Tuesday`,
    t`Wednesday`,
    t`Thursday`,
    t`Friday`,
    t`Saturday`
  ];

  const dayOptions = dayNames.map((label, index) => ({
    label,
    value: String(index)
  }));

  const sortedShifts = [...shifts].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
  );

  return (
    <VStack spacing={2} className="w-full">
      <h3 className="text-sm font-medium">
        <Trans>Weekly Pattern</Trans>
      </h3>
      {sortedShifts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>No shifts defined</Trans>
        </p>
      )}
      {sortedShifts.map((shift) => (
        <div
          key={shift.id}
          className="flex w-full items-center justify-between rounded-md border px-3 py-2"
        >
          <span className="text-sm">{dayNames[shift.dayOfWeek]}</span>
          <span className="text-sm text-muted-foreground">
            {shift.startTime.slice(0, 5)} – {shift.endTime.slice(0, 5)}
          </span>
          <deleteFetcher.Form method="post">
            <input type="hidden" name="intent" value="delete-shift" />
            <input type="hidden" name="id" value={shift.id} />
            <IconButton
              type="submit"
              aria-label={t`Delete shift`}
              icon={<LuTrash />}
              variant="ghost"
              isDisabled={isDisabled}
            />
          </deleteFetcher.Form>
        </div>
      ))}
      <ValidatedForm
        validator={resourceCalendarShiftValidator}
        method="post"
        fetcher={addFetcher}
        resetAfterSubmit
        defaultValues={{ resourceCalendarId: calendarId }}
        className="w-full rounded-md border p-3"
      >
        <Hidden name="intent" value="upsert-shift" />
        <Hidden name="resourceCalendarId" />
        <VStack spacing={2}>
          <Select name="dayOfWeek" label={t`Day`} options={dayOptions} />
          <div className="grid w-full grid-cols-2 gap-2">
            <TimePicker name="startTime" label={t`Start Time`} />
            <TimePicker name="endTime" label={t`End Time`} />
          </div>
          <Submit
            variant="secondary"
            withBlocker={false}
            isDisabled={isDisabled}
          >
            <Trans>Add Shift</Trans>
          </Submit>
        </VStack>
      </ValidatedForm>
    </VStack>
  );
}

function ExceptionsSection({
  calendarId,
  exceptions,
  isDisabled
}: {
  calendarId: string;
  exceptions: ResourceCalendarException[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const addFetcher = useFetcher<{}>();
  const deleteFetcher = useFetcher<{}>();

  const typeOptions = [
    { label: t`Closed`, value: "Closed" },
    { label: t`Open`, value: "Open" },
    { label: t`Reduced Capacity`, value: "ReducedCapacity" }
  ];

  return (
    <VStack spacing={2} className="w-full">
      <h3 className="text-sm font-medium">
        <Trans>Exceptions</Trans>
      </h3>
      {exceptions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>No exceptions defined</Trans>
        </p>
      )}
      {exceptions.map((exception) => (
        <div
          key={exception.id}
          className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="flex flex-col">
            <span className="text-sm">{exception.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(exception.startAt)} –{" "}
              {formatDateTime(exception.endAt)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {exception.type === "ReducedCapacity" ? (
              <Trans>Reduced Capacity</Trans>
            ) : exception.type === "Open" ? (
              <Trans>Open</Trans>
            ) : (
              <Trans>Closed</Trans>
            )}
          </span>
          <deleteFetcher.Form method="post">
            <input type="hidden" name="intent" value="delete-exception" />
            <input type="hidden" name="id" value={exception.id} />
            <IconButton
              type="submit"
              aria-label={t`Delete exception`}
              icon={<LuTrash />}
              variant="ghost"
              isDisabled={isDisabled}
            />
          </deleteFetcher.Form>
        </div>
      ))}
      <ValidatedForm
        validator={resourceCalendarExceptionValidator}
        method="post"
        fetcher={addFetcher}
        resetAfterSubmit
        defaultValues={{ resourceCalendarId: calendarId }}
        className="w-full rounded-md border p-3"
      >
        <Hidden name="intent" value="upsert-exception" />
        <Hidden name="resourceCalendarId" />
        <VStack spacing={2}>
          <Input name="name" label={t`Name`} />
          <DateTimePicker name="startAt" label={t`Start`} />
          <DateTimePicker name="endAt" label={t`End`} />
          <Select name="type" label={t`Type`} options={typeOptions} />
          <Number name="capacityOverride" label={t`Capacity Override`} />
          <Submit
            variant="secondary"
            withBlocker={false}
            isDisabled={isDisabled}
          >
            <Trans>Add Exception</Trans>
          </Submit>
        </VStack>
      </ValidatedForm>
    </VStack>
  );
}

export default ResourceCalendarForm;
