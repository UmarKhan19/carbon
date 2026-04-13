import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Reorder, useDragControls } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { IssueActionTask } from "~/modules/quality";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { TaskItem, TaskProgress } from "./IssueTask";

function ReorderableTaskItem({
  taskId,
  task,
  suppliers,
  isDisabled
}: {
  taskId: string;
  task: IssueActionTask;
  suppliers: { supplierId: string; externalLinkId: string | null }[];
  isDisabled: boolean;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      key={taskId}
      value={taskId}
      dragListener={false}
      dragControls={dragControls}
    >
      <TaskItem
        task={task}
        type="action"
        suppliers={suppliers}
        isDisabled={isDisabled}
        showDragHandle={true}
        dragControls={dragControls}
      />
    </Reorder.Item>
  );
}

export function ActionTasksList({
  tasks,
  suppliers,
  isDisabled
}: {
  tasks: IssueActionTask[];
  suppliers: { supplierId: string; externalLinkId: string | null }[];
  isDisabled: boolean;
}) {
  const sortOrderFetcher = useFetcher<{}>();

  // Initialize sort order state based on existing tasks
  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...tasks]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((task) => task.id)
  );

  // Update sort order when tasks change
  useEffect(() => {
    if (tasks && tasks.length > 0) {
      const sorted = [...tasks]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((task) => task.id);
      setSortOrder(sorted);
    }
  }, [tasks]);

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.issueActionTasksOrder
      });
    },
    1000,
    true
  );

  if (tasks.length === 0) return <NewAction isDisabled={isDisabled} />;

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>Actions</Trans>
          </CardTitle>
        </CardHeader>
        <TaskProgress tasks={tasks} />
      </HStack>
      <CardContent>
        <Reorder.Group
          axis="y"
          values={sortOrder}
          onReorder={onReorder}
          className="w-full space-y-3"
        >
          {sortOrder.map((taskId) => {
            const task = tasks.find((t) => t.id === taskId);
            if (!task) return null;
            return (
              <ReorderableTaskItem
                key={taskId}
                taskId={taskId}
                task={task}
                suppliers={suppliers}
                isDisabled={isDisabled}
              />
            );
          })}
        </Reorder.Group>
      </CardContent>
    </Card>
  );
}

function NewAction({ isDisabled }: { isDisabled: boolean }) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const [isOpen, setIsOpen] = useState(false);
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);

  const routeData = useRouteData<{
    requiredActions: ListItem[];
  }>(path.to.issue(id));

  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setIsOpen(false);
      setSelectedActionIds([]);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "requiredActionIds");
    formData.append("value", selectedActionIds.join(","));

    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateIssue
    });
  }, [id, selectedActionIds, fetcher]);

  const handleCheckboxChange = useCallback(
    (actionId: string, checked: boolean) => {
      setSelectedActionIds((prev) =>
        checked ? [...prev, actionId] : prev.filter((id) => id !== actionId)
      );
    },
    []
  );

  return (
    <>
      <button
        className="flex items-center justify-start bg-card border-2 border-dashed border-background w-full hover:bg-background/80 rounded-lg px-10 py-6 text-muted-foreground hover:text-foreground gap-2 transition-colors duration-200 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setIsOpen(true)}
        disabled={isDisabled}
      >
        <LuCirclePlus size={16} /> <span>Add Actions</span>
      </button>

      <Modal
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsOpen(false);
            setSelectedActionIds([]);
          }
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Required Actions</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={2}>
              {routeData?.requiredActions.map((action) => (
                <label
                  key={action.id}
                  htmlFor={action.id}
                  className="flex items-center gap-2 w-full px-4 py-3 rounded-lg hover:bg-accent hover:text-accent-foreground border border-border cursor-pointer"
                >
                  <Checkbox
                    id={action.id}
                    isChecked={selectedActionIds.includes(action.id)}
                    onCheckedChange={(checked) =>
                      handleCheckboxChange(action.id, !!checked)
                    }
                  />
                  <span className="text-sm font-medium">{action.name}</span>
                </label>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsOpen(false);
                setSelectedActionIds([]);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                selectedActionIds.length === 0 || fetcher.state !== "idle"
              }
              isLoading={fetcher.state === "submitting"}
            >
              {fetcher.state !== "idle" ? (
                <Trans>Adding...</Trans>
              ) : (
                <Trans>Add Actions</Trans>
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
