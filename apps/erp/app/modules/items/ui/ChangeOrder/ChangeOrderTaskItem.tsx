import {
  BarProgress,
  Button,
  cn,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import {
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuLoaderCircle
} from "react-icons/lu";
import { useFetchers, useSubmit } from "react-router";
import { Assignee } from "~/components";
import { IssueTaskStatusIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";
import type {
  ChangeOrderApprovalTask,
  ChangeOrderReviewer,
  ChangeOrderTaskStatusEnum
} from "~/modules/items";
import { path } from "~/utils/path";

export type ChangeOrderTaskType = "approval" | "review";

type AnyChangeOrderTask = ChangeOrderApprovalTask | ChangeOrderReviewer;

// Mirrors statusActions in quality/ui/Issue/IssueTask.tsx — the single forward
// transition button shown for the current status.
export const statusActions = {
  Completed: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending"
  },
  Pending: {
    action: "Start",
    icon: <LuCirclePlay />,
    status: "In Progress"
  },
  Skipped: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending"
  },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    status: "Completed"
  }
} as const;

const changeOrderTable = {
  approval: "changeOrderApprovalTask",
  review: "changeOrderReviewer"
} as const;

export function ChangeOrderTaskProgress({
  tasks,
  className
}: {
  tasks: { status: ChangeOrderTaskStatusEnum }[];
  className?: string;
}) {
  if (tasks.length === 0) return null;

  const completedOrSkippedTasks = tasks.filter(
    (task) => task.status === "Completed" || task.status === "Skipped"
  ).length;
  const progressPercentage = (completedOrSkippedTasks / tasks.length) * 100;

  return (
    <div
      className={cn(
        "flex flex-col items-end gap-2 py-3 pr-14 w-[120px]",
        className
      )}
    >
      <BarProgress
        gradient
        progress={progressPercentage}
        value={`${completedOrSkippedTasks}/${tasks.length}`}
      />
    </div>
  );
}

function useChangeOrderTaskStatus({
  task,
  type,
  isDisabled = false
}: {
  task: AnyChangeOrderTask;
  type: ChangeOrderTaskType;
  isDisabled?: boolean;
}) {
  const submit = useSubmit();
  const { id: userId } = useUser();
  const fetchers = useFetchers();

  const pendingUpdate = fetchers.find(
    (f) =>
      f.formData?.get("id") === task.id &&
      f.key === `changeOrderTask:${task.id}`
  );
  const optimisticStatus = pendingUpdate?.formData?.get("status") as
    | ChangeOrderTaskStatusEnum
    | undefined;

  const onStatusChange = useCallback(
    (id: string, status: ChangeOrderTaskStatusEnum) => {
      if (isDisabled) return;
      submit(
        {
          id,
          status,
          type,
          assignee: task.assignee ?? userId
        },
        {
          method: "post",
          action: path.to.changeOrderTaskStatus(id),
          navigate: false,
          fetcherKey: `changeOrderTask:${id}`
        }
      );
    },
    [submit, type, task.assignee, userId, isDisabled]
  );

  return {
    currentStatus: (optimisticStatus ??
      task.status) as ChangeOrderTaskStatusEnum,
    onStatusChange
  };
}

export function ChangeOrderTaskItem({
  task,
  type,
  isDisabled = false
}: {
  task: AnyChangeOrderTask;
  type: ChangeOrderTaskType;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const disclosure = useDisclosure({ defaultIsOpen: false });

  const canEdit = permissions.can("update", "production") && !isDisabled;
  const { currentStatus, onStatusChange } = useChangeOrderTaskStatus({
    task,
    type,
    isDisabled: !canEdit
  });

  const statusAction = statusActions[currentStatus];

  // changeOrderApprovalTask carries a `name` label column; changeOrderReviewer
  // carries a `title`.
  const taskTitle =
    type === "review"
      ? (task as ChangeOrderReviewer).title
      : (task as ChangeOrderApprovalTask).name;

  // Reviewer rows persist their decision reason into notes as { reason, decision }
  // (see applyChangeOrderReviewerDecision). Surface that reason when expanded.
  const reviewerNotes =
    type === "review" ? (task as ChangeOrderReviewer).notes : null;
  const decisionReason =
    reviewerNotes &&
    typeof reviewerNotes === "object" &&
    !Array.isArray(reviewerNotes) &&
    typeof (reviewerNotes as { reason?: unknown }).reason === "string"
      ? (reviewerNotes as { reason: string }).reason
      : null;

  return (
    <div className="rounded-lg border w-full flex flex-col bg-card">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <div className="flex flex-col flex-1">
          <span className="text-base font-semibold tracking-tight">
            {taskTitle}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={<LuChevronRight />}
            variant="ghost"
            onClick={disclosure.onToggle}
            aria-label={t`Open task details`}
            className={cn(disclosure.isOpen && "rotate-90")}
          />
        </div>
      </div>

      {disclosure.isOpen && decisionReason && (
        <div className="border-t px-4 py-2 text-sm text-muted-foreground">
          <Trans>Reason</Trans>: {decisionReason}
        </div>
      )}

      <div className="bg-muted/30 border-t px-4 py-2 flex justify-between w-full">
        <HStack>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t`Status`}
            icon={<IssueTaskStatusIcon status={currentStatus} />}
            isDisabled
          />
          <Assignee
            table={changeOrderTable[type]}
            id={task.id}
            size="sm"
            value={task.assignee ?? undefined}
            disabled={!canEdit}
          />
        </HStack>
        <HStack>
          {currentStatus !== "Skipped" && currentStatus !== "Completed" && (
            <Button
              isDisabled={!canEdit}
              variant="ghost"
              size="sm"
              onClick={() => onStatusChange(task.id!, "Skipped")}
            >
              <Trans>Skip</Trans>
            </Button>
          )}
          <Button
            isDisabled={!canEdit}
            leftIcon={statusAction.icon}
            variant="secondary"
            size="sm"
            onClick={() => onStatusChange(task.id!, statusAction.status)}
          >
            {statusAction.action}
          </Button>
        </HStack>
      </div>
    </div>
  );
}
