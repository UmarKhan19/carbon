import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Item, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderAffectedItemValidator } from "../../changeOrder.models";
import AffectedItemCard from "./AffectedItemCard";
// AffectedItemDraft now lives in ./affectedItem.types (so the new sidebar/detail
// panes can share it without a component-to-component dependency); re-exported
// here for callers that still import it from this module.
import type { AffectedItemDraft } from "./affectedItem.types";
export type { AffectedItemDraft };

// The first-class card at the top of the change-order detail: a Part/Tool picker
// to add affected items, and a list of expandable AffectedItemCard rows. Adding
// one snapshots its current method + attributes into staging (service side).
export default function AffectedItems({
  id,
  affectedItems,
  isDisabled
}: {
  id: string;
  affectedItems: AffectedItemDraft[];
  isDisabled: boolean;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Affected Items</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={2}>
            {affectedItems.length === 0 && (
              <span className="text-sm text-muted-foreground italic">
                <Trans>No affected items yet — add a part or tool below.</Trans>
              </span>
            )}
            {!isDisabled && (
              <AddAffectedItem
                id={id}
                blacklist={affectedItems.map((a) => a.affectedItem.itemId)}
              />
            )}
          </VStack>
        </CardContent>
      </Card>

      {affectedItems.map((affected) => (
        <AffectedItemCard
          key={affected.affectedItem.id}
          changeOrderId={id}
          affected={affected}
          isDisabled={isDisabled}
        />
      ))}
    </VStack>
  );
}

function AddAffectedItem({
  id,
  blacklist
}: {
  id: string;
  blacklist: string[];
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffected(id)}
      validator={changeOrderAffectedItemValidator}
      defaultValues={{ changeOrderId: id, itemId: "" }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={id} />
      <HStack className="w-full items-end gap-2">
        <div className="flex-grow">
          <Item
            name="itemId"
            label={t`Add affected item`}
            type="Part"
            validItemTypes={["Part", "Tool"]}
            blacklist={blacklist}
          />
        </div>
        <Submit leftIcon={<LuPlus />}>
          <Trans>Add</Trans>
        </Submit>
      </HStack>
    </ValidatedForm>
  );
}
