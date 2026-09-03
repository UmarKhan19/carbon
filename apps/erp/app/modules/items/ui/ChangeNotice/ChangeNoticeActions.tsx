import {
  Button,
  DatePicker,
  IconButton,
  type JSONContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDebounce
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCalendar, LuTrash2 } from "react-icons/lu";
import { useFetcher, useFetchers, useSubmit } from "react-router";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { ActionTaskList } from "~/components/ActionTasks/ActionTaskList";
import { ActionTaskStatusButton } from "~/components/ActionTasks/ActionTaskStatusButton";
import { JiraIssueDialog } from "~/components/ActionTasks/Jira/IssueDialog";
import { LinearIssueDialog } from "~/components/ActionTasks/Linear/IssueDialog";
import { syncActionTaskNotes } from "~/components/ActionTasks/syncNotes";
import {
  useDateFormatter,
  useImageUpload,
  usePermissions,
  useRouteData
} from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { canEditChangeNoticeActionTaskFields } from "../../items.models";
import type { ChangeNoticeActionTask, ChangeNoticeStatus } from "../../types";

// Change-order actions — a thin wrapper over the shared ActionTaskList (same
// component the Quality issue uses). Adding picks from the change notice's
// configured required-action templates via the "Add Actions" modal and writes
// back through the reconcile route (`$id.action`), which instantiates the union
// of the current tasks and the newly-picked templates. Each row is an ActionItem
// (notes, status, assignee, due date) with an inline delete. All actions live here on the
// top-level detail route.
export default function ChangeNoticeActions({
  changeOrderId,
  changeNoticeStatus,
  actions,
  canEditWorkflow
}: {
  changeOrderId: string;
  changeNoticeStatus: ChangeNoticeStatus;
  actions: ChangeNoticeActionTask[];
  canEditWorkflow: boolean;
}) {
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeNotice(changeOrderId)
  );
  const addFetcher = useFetcher<{ success: boolean }>();

  // The reconcile route (`setChangeNoticeActionTasks`) sets the exact set of
  // tasks from the posted actionTypeIds, so adding posts the union of the current
  // tasks' types and the newly-picked templates (removal is per-card, below).
  const onAdd = useCallback(
    (selectedIds: string[]) => {
      const existing = actions
        .map((a) => a.actionTypeId)
        .filter((id): id is string => Boolean(id));
      const merged = Array.from(new Set([...existing, ...selectedIds]));
      const formData = new FormData();
      formData.append("actionIds", merged.join(","));
      addFetcher.submit(formData, {
        method: "post",
        action: path.to.changeNoticeAction(changeOrderId)
      });
    },
    [actions, changeOrderId, addFetcher]
  );

  return (
    <ActionTaskList
      tasks={actions}
      reorderAction={path.to.changeNoticeActionOrder(changeOrderId)}
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isAddSubmitting={addFetcher.state !== "idle"}
      isDisabled={!canEditWorkflow}
      renderItem={(action, dragControls) => (
        <ActionItem
          changeOrderId={changeOrderId}
          changeNoticeStatus={changeNoticeStatus}
          action={action}
          canEditWorkflow={canEditWorkflow}
          dragControls={dragControls}
        />
      )}
    />
  );
}

// The CO wrapper over the shared ActionTaskCard: owns CO-specific persistence
// (notes, status, assignee, and due date) while keeping workflow operations
// separate from task-field editability.
function ActionItem({
  changeOrderId,
  changeNoticeStatus,
  action,
  canEditWorkflow,
  dragControls
}: {
  changeOrderId: string;
  changeNoticeStatus: ChangeNoticeStatus;
  action: ChangeNoticeActionTask;
  canEditWorkflow: boolean;
  dragControls: DragControls;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const integrations = useIntegrations();
  const statusFetcher = useFetcher<{ success: boolean }>();
  const notesFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const [content, setContent] = useState((action.notes ?? {}) as JSONContent);
  const status = (action.status ?? "Pending") as ActionTaskStatus;
  const canEditTaskFields =
    permissions.can("update", "parts") &&
    canEditChangeNoticeActionTaskFields(changeNoticeStatus, action.taskOrigin);
  const canDelete = permissions.can("delete", "parts") && canEditWorkflow;
  const pendingNotes = useRef<JSONContent | null>(null);

  const onUploadImage = useImageUpload("parts");

  const hasLinearLink = !!action.linearIssue;
  const hasJiraLink = !!action.jiraIssue;

  const syncLinkedNotes = useCallback(
    async (value: JSONContent) => {
      if (hasLinearLink) {
        await syncActionTaskNotes("Linear", {
          actionId: action.id,
          entityType: "changeOrderActionTask",
          notes: value
        });
      }

      if (hasJiraLink) {
        await syncActionTaskNotes("Jira", {
          actionId: action.id,
          entityType: "changeOrderActionTask",
          notes: value
        });
      }
    },
    [action.id, hasJiraLink, hasLinearLink]
  );

  useEffect(() => {
    if (notesFetcher.state !== "idle" || notesFetcher.data?.success !== true) {
      return;
    }

    const notes = pendingNotes.current;
    if (!notes) return;

    pendingNotes.current = null;
    void syncLinkedNotes(notes);
  }, [notesFetcher.data, notesFetcher.state, syncLinkedNotes]);

  const onUpdateContent = useDebounce(
    (value: JSONContent) => {
      pendingNotes.current = value;
      const formData = new FormData();
      formData.append("id", action.id);
      formData.append("notes", JSON.stringify(value));
      notesFetcher.submit(formData, {
        method: "post",
        action: path.to.changeNoticeActionNotes(changeOrderId, action.id)
      });
    },
    2500,
    true
  );

  const onStatusChange = (next: ActionTaskStatus) => {
    if (!canEditTaskFields) return;
    const formData = new FormData();
    formData.append("id", action.id);
    formData.append("status", next);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.changeNoticeActionStatus(changeOrderId, action.id)
    });
  };

  const onDelete = () => {
    if (!canEditWorkflow) return;
    deleteFetcher.submit(
      {},
      {
        method: "post",
        action: path.to.deleteChangeNoticeAction(changeOrderId, action.id)
      }
    );
  };

  return (
    <ActionTaskCard
      title={action.name ?? ""}
      status={status}
      notes={content}
      canEditNotes={canEditTaskFields}
      onNotesChange={(value) => {
        setContent(value);
        onUpdateContent(value);
      }}
      onUploadImage={onUploadImage}
      onStatusChange={onStatusChange}
      assigneeTable="changeOrderActionTask"
      assigneeId={action.id}
      assignee={action.assignee ?? undefined}
      assignmentAction={path.to.changeNoticeActionAssignee(
        changeOrderId,
        action.id
      )}
      isDisabled={!canEditTaskFields}
      showDragHandle={canEditWorkflow}
      dragControls={dragControls}
      statusBadge={
        <ActionTaskStatusButton
          status={status}
          onChange={onStatusChange}
          isDisabled={!canEditTaskFields}
        />
      }
      headerExtras={
        <>
          {integrations.has("linear") && (
            <LinearIssueDialog
              entityType="changeOrderActionTask"
              taskId={action.id}
              linkedIssue={action.linearIssue}
            />
          )}
          {integrations.has("jira") && (
            <JiraIssueDialog
              entityType="changeOrderActionTask"
              taskId={action.id}
              linkedIssue={action.jiraIssue}
            />
          )}
          {canDelete && (
            <IconButton
              aria-label={t`Delete action`}
              icon={<LuTrash2 />}
              variant="ghost"
              onClick={onDelete}
              isDisabled={deleteFetcher.state !== "idle"}
            />
          )}
        </>
      }
      footerExtras={
        <TaskDueDate
          changeOrderId={changeOrderId}
          task={action}
          isDisabled={!canEditTaskFields}
        />
      }
    />
  );
}

function TaskDueDate({
  changeOrderId,
  task,
  isDisabled
}: {
  changeOrderId: string;
  task: ChangeNoticeActionTask;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const submit = useSubmit();
  const [isOpen, setIsOpen] = useState(false);
  const permissions = usePermissions();
  const fetchers = useFetchers();
  const canEdit = permissions.can("update", "parts") && !isDisabled;
  const pendingUpdate = fetchers.find(
    (fetcher) =>
      fetcher.formData?.get("id") === task.id &&
      fetcher.key === `changeNoticeTaskDueDate:${task.id}`
  );
  const pendingValue = pendingUpdate?.formData?.get("dueDate") ?? task.dueDate;

  const handleDateChange = (date: string | null) => {
    submit(
      {
        id: task.id,
        dueDate: date || ""
      },
      {
        method: "post",
        action: path.to.changeNoticeActionDueDate(changeOrderId, task.id),
        navigate: false,
        fetcherKey: `changeNoticeTaskDueDate:${task.id}`
      }
    );
  };

  if (!canEdit) {
    return (
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<LuCalendar />}
        isDisabled
      >
        <span>{task.dueDate ? formatDate(task.dueDate) : t`No due date`}</span>
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger disabled={isDisabled} asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuCalendar />}
          isDisabled={isDisabled}
        >
          {pendingValue ? formatDate(String(pendingValue)) : t`Due Date`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-2">
          <DatePicker
            value={pendingValue ? parseDate(String(pendingValue)) : null}
            onChange={(date) => handleDateChange(date?.toString() || null)}
          />
          {pendingValue && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDateChange(null)}
              className="w-full"
            >
              <Trans>Clear due date</Trans>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
