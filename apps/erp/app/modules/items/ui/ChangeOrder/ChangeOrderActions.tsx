import { ValidatedForm } from "@carbon/form";
import {
  BarProgress,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import { useEffect, useState } from "react";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuGripVertical,
  LuLoaderCircle,
  LuTrash2
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import { DatePicker, Employee, Hidden, Input, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderActionValidator } from "../../changeOrder.models";
import type { ChangeOrderActionTask } from "../../types";

// Next status on the Start/Complete/Reopen button, mirroring Quality.
const statusActions = {
  Pending: { action: "Start", icon: <LuCirclePlay />, next: "In Progress" },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    next: "Completed"
  },
  Completed: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" },
  Skipped: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" }
} as const;

export function ChangeOrderActionsProgress({
  actions
}: {
  actions: { status: ChangeOrderActionTask["status"] }[];
}) {
  const done = actions.filter(
    (a) => a.status === "Completed" || a.status === "Skipped"
  ).length;
  const progress = actions.length > 0 ? (done / actions.length) * 100 : 0;

  return (
    <div className="flex flex-col items-end gap-2 py-3 pr-14 w-[120px]">
      <BarProgress
        gradient
        progress={progress}
        value={`${done}/${actions.length}`}
      />
    </div>
  );
}

export default function ChangeOrderActions({
  changeOrderId,
  actions,
  isDisabled
}: {
  changeOrderId: string;
  actions: ChangeOrderActionTask[];
  isDisabled: boolean;
}) {
  const orderFetcher = useFetcher<{ success: boolean }>();

  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...actions]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((a) => a.id)
  );

  useEffect(() => {
    setSortOrder(
      [...actions]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((a) => a.id)
    );
  }, [actions]);

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      orderFetcher.submit(formData, {
        method: "post",
        action: path.to.changeOrderActionOrder(changeOrderId)
      });
    },
    1000,
    true
  );

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;
    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  return (
    <Card className="w-full">
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Actions</Trans>
          </CardTitle>
        </CardHeader>
        {actions.length > 0 && <ChangeOrderActionsProgress actions={actions} />}
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {actions.length > 0 && (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full space-y-3"
            >
              {sortOrder.map((id) => {
                const action = actions.find((a) => a.id === id);
                if (!action) return null;
                return (
                  <ReorderableActionItem
                    key={id}
                    changeOrderId={changeOrderId}
                    action={action}
                    isDisabled={isDisabled}
                  />
                );
              })}
            </Reorder.Group>
          )}

          {!isDisabled && <NewAction changeOrderId={changeOrderId} />}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ReorderableActionItem({
  changeOrderId,
  action,
  isDisabled
}: {
  changeOrderId: string;
  action: ChangeOrderActionTask;
  isDisabled: boolean;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={action.id}
      dragListener={false}
      dragControls={dragControls}
    >
      <ActionItem
        changeOrderId={changeOrderId}
        action={action}
        isDisabled={isDisabled}
        dragControls={dragControls}
      />
    </Reorder.Item>
  );
}

function ActionItem({
  changeOrderId,
  action,
  isDisabled,
  dragControls
}: {
  changeOrderId: string;
  action: ChangeOrderActionTask;
  isDisabled: boolean;
  dragControls: DragControls;
}) {
  const { t } = useLingui();
  const statusFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const status = (action.status ?? "Pending") as keyof typeof statusActions;
  const statusAction = statusActions[status];
  const isComplete = status === "Completed" || status === "Skipped";

  const onStatusChange = () => {
    if (isDisabled) return;
    const formData = new FormData();
    formData.append("id", action.id);
    formData.append("status", statusAction.next);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderActionStatus(changeOrderId, action.id)
    });
  };

  return (
    <HStack className="w-full justify-between border border-border rounded-lg p-3">
      <HStack spacing={2}>
        {!isDisabled && (
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-1"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <LuGripVertical size={16} />
          </button>
        )}
        <VStack spacing={0}>
          <span
            className={cn(
              "text-sm font-medium",
              isComplete && "line-through text-muted-foreground"
            )}
          >
            {action.name}
          </span>
          <HStack spacing={2}>
            {action.assignee && (
              <EmployeeAvatar employeeId={action.assignee} size="xxs" />
            )}
            {action.dueDate && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {action.dueDate}
              </span>
            )}
          </HStack>
        </VStack>
      </HStack>
      <HStack spacing={1}>
        <Button
          isDisabled={isDisabled}
          leftIcon={statusAction.icon}
          variant="secondary"
          size="sm"
          onClick={onStatusChange}
        >
          {statusAction.action}
        </Button>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderAction(changeOrderId, action.id)}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove action`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>
    </HStack>
  );
}

function NewAction({ changeOrderId }: { changeOrderId: string }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAction(changeOrderId)}
      validator={changeOrderActionValidator}
      defaultValues={{
        changeOrderId,
        name: "",
        assignee: "",
        dueDate: ""
      }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={changeOrderId} />
      <HStack className="w-full items-end gap-2">
        <div className="flex-grow">
          <Input name="name" label={t`New action`} />
        </div>
        <div className="w-48">
          <Employee name="assignee" label={t`Assignee`} />
        </div>
        <div className="w-40">
          <DatePicker name="dueDate" label={t`Due date`} />
        </div>
        <Submit>
          <Trans>Add</Trans>
        </Submit>
      </HStack>
    </ValidatedForm>
  );
}
