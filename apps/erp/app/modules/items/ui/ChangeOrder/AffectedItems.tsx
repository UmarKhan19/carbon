import type { Database } from "@carbon/database";
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
import type { ChangeOrderItemDiff } from "../../changeOrder.models";
import { changeOrderAffectedItemValidator } from "../../changeOrder.models";
import type {
  ChangeOrderAffectedItemWithLabel,
  ChangeOrderStagedMaterialWithLabel
} from "../../changeOrder.staging";
import AffectedItemCard from "./AffectedItemCard";
import type { ChangeOrderBopChildrenData } from "./ChangeOrderBopChildren";

type StagedOperation =
  Database["public"]["Tables"]["changeOrderStagedOperation"]["Row"];
type StagedAttributes =
  Database["public"]["Tables"]["changeOrderStagedItemAttributes"]["Row"];

// The live item's current editable values — the "old" side of the attribute
// redline shown by ChangeOrderAttributesEditor.
export type AffectedItemSourceAttributes = {
  itemId: string;
  name: string | null;
  description: string | null;
  unitOfMeasureCode: string | null;
  itemTrackingType: string | null;
  defaultMethodType: string | null;
  replenishmentSystem: string | null;
  sourcingType: string | null;
  requiresInspection: boolean | null;
  thumbnailPath: string | null;
  modelId?: string | null;
};

// One affected item plus its staged method + attributes + diff — the shape the
// $id loader assembles per affected item and the card consumes.
export type AffectedItemStaging = {
  affectedItem: ChangeOrderAffectedItemWithLabel;
  materials: ChangeOrderStagedMaterialWithLabel[];
  operations: StagedOperation[];
  // Staged BOP operation children keyed by staged operation id.
  operationChildren: Record<string, ChangeOrderBopChildrenData>;
  attributes: StagedAttributes | null;
  source: AffectedItemSourceAttributes;
  diff?: ChangeOrderItemDiff;
};

// The first-class card at the top of the change-order detail: a Part/Tool picker
// to add affected items, and a list of expandable AffectedItemCard rows. Adding
// one snapshots its current method + attributes into staging (service side).
export default function AffectedItems({
  id,
  affectedItems,
  isDisabled
}: {
  id: string;
  affectedItems: AffectedItemStaging[];
  isDisabled: boolean;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Affected Items</Trans>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            <Trans>
              Pick the parts or tools to change. Each gets a staged copy of its
              current method and attributes to edit.
            </Trans>
          </span>
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
