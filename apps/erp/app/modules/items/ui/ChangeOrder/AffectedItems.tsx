import { ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
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
import type { MethodItemType, MethodType } from "../../../shared";
import type { ChangeOrderItemDiff } from "../../changeOrder.models";
import { changeOrderAffectedItemValidator } from "../../changeOrder.models";
import type { ChangeOrderAffectedItemWithLabel } from "../../changeOrder.service";
import type { getRevisionLock } from "../../items.server";
import type {
  getConfigurationParameters,
  getConfigurationRules,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "../../items.service";
import type { MakeMethod } from "../../types";
import AffectedItemCard from "./AffectedItemCard";

type RevisionLock = Awaited<ReturnType<typeof getRevisionLock>>;

type DraftMaterial = NonNullable<
  Awaited<ReturnType<typeof getMethodMaterialsByMakeMethod>>["data"]
>[number];
type DraftOperation = NonNullable<
  Awaited<ReturnType<typeof getMethodOperationsByMakeMethodId>>["data"]
>[number];
type DraftConfigParameters = Awaited<
  ReturnType<typeof getConfigurationParameters>
>["parameters"];
type DraftConfigRules = Awaited<ReturnType<typeof getConfigurationRules>>;

// The $id loader normalizes the raw rows (adds description, coerces nullable
// ids to undefined) exactly as the part make-method route does — these mapped
// shapes are what the embedded editors consume.
type DraftMaterialMapped = Omit<
  DraftMaterial,
  "description" | "methodOperationId" | "methodType" | "itemType"
> & {
  description: string;
  methodOperationId: string | undefined;
  methodType: MethodType;
  itemType: MethodItemType;
};
type DraftOperationMapped = Omit<
  DraftOperation,
  | "description"
  | "procedureId"
  | "operationSupplierProcessId"
  | "operationMinimumCost"
  | "operationLeadTime"
  | "operationUnitCost"
  | "tags"
  | "workCenterId"
  | "workInstruction"
> & {
  description: string;
  procedureId: string | undefined;
  operationSupplierProcessId: string | undefined;
  operationMinimumCost: number;
  operationLeadTime: number;
  operationUnitCost: number;
  tags: string[];
  workCenterId: string | undefined;
  workInstruction: JSONContent | null;
};

// v2: one affected item plus its CO-owned Draft make method (real rows shaped
// for the embedded BillOfMaterial / BillOfProcess editors), the change type, and
// the read-only authoring diff. The $id loader assembles this per affected item.
export type AffectedItemDraft = {
  affectedItem: ChangeOrderAffectedItemWithLabel;
  // The item the draft edits — the same item for a Version, the new item for
  // Revision / New Part.
  draftItemId: string;
  makeMethod: MakeMethod | null;
  methodMaterials: DraftMaterialMapped[];
  methodOperations: DraftOperationMapped[];
  tags: { name: string }[];
  configurable: boolean;
  configurationRules: DraftConfigRules;
  parameters: DraftConfigParameters;
  replenishmentSystem?: string;
  revisionStatus: RevisionLock["revisionStatus"];
  releaseControl: RevisionLock["releaseControl"] | null;
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
