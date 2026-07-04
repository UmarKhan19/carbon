import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import type { PeriodCloseTaskView } from "~/modules/accounting";
import {
  closePeriodWithChecklist,
  closeTaskCompleteValidator,
  closeTaskSkipValidator,
  completeCloseTask,
  getAccountingPeriods,
  getPeriodCloseChecklist,
  skipCloseTask
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Close Period",
  to: path.to.accountingPeriods
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const [checklist, periods] = await Promise.all([
    getPeriodCloseChecklist(client, companyId, periodId),
    getAccountingPeriods(client, companyId)
  ]);

  if (checklist.error || !checklist.data) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(
        request,
        error(checklist.error, "Failed to load the close checklist")
      )
    );
  }

  const period = (periods.data ?? []).find((p) => p.id === periodId) ?? null;

  return { checklist: checklist.data, period };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "completeTask") {
    const validation = await validator(closeTaskCompleteValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const result = await completeCloseTask(client, {
      taskId: validation.data.taskId,
      notes: validation.data.notes,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to complete task"))
      );
    }
    return data({}, await flash(request, success("Task marked done")));
  }

  if (intent === "skipTask") {
    const validation = await validator(closeTaskSkipValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const result = await skipCloseTask(client, {
      taskId: validation.data.taskId,
      skippedReason: validation.data.skippedReason,
      companyId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to skip task"))
      );
    }
    return data({}, await flash(request, success("Task skipped")));
  }

  if (intent === "close") {
    const result = await closePeriodWithChecklist(client, {
      companyId,
      periodId,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, result.error.message ?? "Failed to close period")
        )
      );
    }
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, success("Period closed"))
    );
  }

  throw redirect(path.to.accountingPeriodClose(periodId));
}

const SEVERITY_COLOR = {
  Blocker: "red",
  Warning: "yellow"
} as const;

const STATUS_COLOR = {
  Open: "gray",
  Done: "green",
  Skipped: "blue"
} as const;

export default function AccountingPeriodCloseRoute() {
  const { checklist, period } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const closeFetcher = useFetcher<typeof action>();

  const periodLabel =
    period && period.fiscalYear && period.periodNumber
      ? `FY${period.fiscalYear} · Period ${period.periodNumber}`
      : period
        ? formatDate(period.startDate)
        : "Period";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingPeriods);
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Close {periodLabel}</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Every required task must be Done or Skipped before the period can
              be closed.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {checklist.blockingReason && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>
                <Trans>Cannot close yet</Trans>
              </AlertTitle>
              <AlertDescription>{checklist.blockingReason}</AlertDescription>
            </Alert>
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Task</Trans>
                </Th>
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Severity</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Actions</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {checklist.tasks.map((task) => (
                <PeriodCloseTaskRow key={task.id} task={task} />
              ))}
            </Tbody>
          </Table>
        </ModalBody>
        <ModalFooter>
          <closeFetcher.Form method="post">
            <input type="hidden" name="intent" value="close" />
            <Button
              type="submit"
              isDisabled={!checklist.canClose}
              isLoading={closeFetcher.state !== "idle"}
            >
              <Trans>Close Period</Trans>
            </Button>
          </closeFetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function PeriodCloseTaskRow({ task }: { task: PeriodCloseTaskView }) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();
  const [skipping, setSkipping] = useState(false);
  const isBusy = fetcher.state !== "idle";

  const status = task.effectiveStatus;
  const isResolved = status === "Done" || status === "Skipped";
  // Auto tasks are evaluated by the system; only Action/Manual tasks are
  // completed by hand. Blocker tasks can never be skipped (server enforces it),
  // so they get no Skip button.
  const canComplete = task.taskType !== "Auto" && status === "Open";
  const canSkip = task.severity !== "Blocker" && status === "Open";

  return (
    <>
      <Tr>
        <Td className="font-medium">{task.name}</Td>
        <Td>{task.taskType}</Td>
        <Td>
          {task.severity ? (
            <Status color={SEVERITY_COLOR[task.severity]}>
              {task.severity}
            </Status>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>
        <Td>
          <Status color={STATUS_COLOR[status]}>{status}</Status>
        </Td>
        <Td className="text-right">
          <div className="flex justify-end gap-2">
            {canComplete && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="completeTask" />
                <input type="hidden" name="taskId" value={task.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                >
                  <Trans>Mark Done</Trans>
                </Button>
              </fetcher.Form>
            )}
            {canSkip && !skipping && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSkipping(true)}
              >
                <Trans>Skip</Trans>
              </Button>
            )}
            {isResolved && task.skippedReason && (
              <span className="text-muted-foreground text-sm">
                {task.skippedReason}
              </span>
            )}
          </div>
        </Td>
      </Tr>
      {canSkip && skipping && (
        <Tr>
          <Td colSpan={5}>
            <fetcher.Form
              method="post"
              className="flex items-center gap-2"
              onSubmit={() => setSkipping(false)}
            >
              <input type="hidden" name="intent" value="skipTask" />
              <input type="hidden" name="taskId" value={task.id} />
              <Input
                name="skippedReason"
                placeholder={t`Reason for skipping (required)`}
                className="flex-1"
              />
              <Button type="submit" size="sm" isLoading={isBusy}>
                <Trans>Confirm Skip</Trans>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkipping(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </fetcher.Form>
          </Td>
        </Tr>
      )}
    </>
  );
}
