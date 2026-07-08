import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ChangeOrderApprovalTask } from "~/modules/items";
import {
  ChangeOrderTaskItem,
  ChangeOrderTaskProgress
} from "./ChangeOrderTaskItem";

export default function ChangeOrderApprovalTasks({
  tasks,
  isDisabled = false
}: {
  tasks: ChangeOrderApprovalTask[];
  isDisabled?: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>Approvals</Trans>
          </CardTitle>
        </CardHeader>
        <ChangeOrderTaskProgress tasks={tasks} />
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {tasks.map((task) => (
            <ChangeOrderTaskItem
              key={task.id}
              task={task}
              type="approval"
              isDisabled={isDisabled}
            />
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}
