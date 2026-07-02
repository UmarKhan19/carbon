import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ChangeOrderReviewer } from "~/modules/items";
import {
  ChangeOrderTaskItem,
  ChangeOrderTaskProgress
} from "./ChangeOrderTaskItem";

export default function ChangeOrderReviewers({
  reviewers,
  isDisabled = false
}: {
  reviewers: ChangeOrderReviewer[];
  isDisabled?: boolean;
}) {
  if (reviewers.length === 0) return null;

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>Reviewers</Trans>
          </CardTitle>
        </CardHeader>
        <ChangeOrderTaskProgress tasks={reviewers} />
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {reviewers.map((reviewer) => (
            <ChangeOrderTaskItem
              key={reviewer.id}
              task={reviewer}
              type="review"
              isDisabled={isDisabled}
            />
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}
