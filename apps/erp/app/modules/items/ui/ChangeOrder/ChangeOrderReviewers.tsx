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
  changeOrderId,
  changeOrderStatus,
  itemIds,
  isDisabled = false
}: {
  reviewers: ChangeOrderReviewer[];
  changeOrderId: string;
  changeOrderStatus?: string;
  itemIds: string[];
  isDisabled?: boolean;
}) {
  const isEmpty = reviewers.length === 0;

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>Reviewers</Trans>
          </CardTitle>
        </CardHeader>
        {!isEmpty && <ChangeOrderTaskProgress tasks={reviewers} />}
      </HStack>
      <CardContent>
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No approvers yet. Add approvers in the Properties panel to route
              this change order for review.
            </Trans>
          </p>
        ) : (
          <VStack spacing={3}>
            {reviewers.map((reviewer) => (
              <ChangeOrderTaskItem
                key={reviewer.id}
                task={reviewer}
                type="review"
                isDisabled={isDisabled}
                changeOrderId={changeOrderId}
                changeOrderStatus={changeOrderStatus}
                itemIds={itemIds}
              />
            ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
}
