import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DatePicker, Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import {
  changeOrderAffectedItemChangeTypeValidator,
  changeOrderAffectedItemCutoverValidator,
  changeOrderChangeTypes
} from "../../changeOrder.models";
import type { ChangeOrderAffectedItemWithLabel } from "../../changeOrder.service";
import { supersessionModes } from "../../items.models";
import { BillOfMaterial, BillOfProcess } from "../Item";
import type { AffectedItemDraft } from "./AffectedItems";
import ItemLink from "./ItemLink";

const supersessionModeOptions = supersessionModes.map((m) => ({
  value: m,
  label: m
}));

const changeTypeOptions = changeOrderChangeTypes.map((c) => ({
  value: c,
  label: c
}));

// One expandable card per affected item: header (item link + remove), the
// per-item change-type selector (Version / Revision / New Part), the cutover
// control (for Revision / New Part), and the embedded real BillOfMaterial /
// BillOfProcess editors pointed at the affected item's CO-owned Draft method.
export default function AffectedItemCard({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: AffectedItemDraft;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const removeFetcher = useFetcher<{ success: boolean }>();

  const affectedItem = affected.affectedItem;
  const label = affectedItem.item;
  const changeType = affectedItem.changeType;
  // Q2 capability matrix: Version = BoM/BoP only; Revision = attrs/docs only (no
  // BoM/BoP); New Part = both. Version has no supersession (same item).
  const showBomBop = changeType === "Version" || changeType === "New Part";
  const showCutover = changeType !== "Version";

  return (
    <Card className="w-full">
      <HStack className="w-full justify-between">
        <CardHeader>
          <CardTitle>
            <ItemLink
              itemId={affectedItem.itemId}
              type={label?.type}
              className="text-base font-medium"
            >
              {label?.readableIdWithRevision ??
                label?.readableId ??
                affectedItem.itemId}
            </ItemLink>
          </CardTitle>
          {label?.name && (
            <span className="text-xs text-muted-foreground">{label.name}</span>
          )}
        </CardHeader>
        {!isDisabled && (
          <div className="pr-6 pt-6">
            <removeFetcher.Form
              method="post"
              action={path.to.deleteChangeOrderAffected(
                changeOrderId,
                affectedItem.id
              )}
            >
              <IconButton
                type="submit"
                aria-label={t`Remove affected item`}
                variant="ghost"
                icon={<LuTrash2 />}
              />
            </removeFetcher.Form>
          </div>
        )}
      </HStack>
      <CardContent>
        <VStack spacing={4}>
          <ChangeTypeControl
            changeOrderId={changeOrderId}
            affected={affectedItem}
            isDisabled={isDisabled}
          />

          {showCutover && (
            <CutoverControl
              changeOrderId={changeOrderId}
              affected={affectedItem}
              isDisabled={isDisabled}
            />
          )}

          {changeType === "Revision" && (
            <p className="text-sm text-muted-foreground py-2">
              <Trans>
                A Revision changes part data / documentation only (no BoM/BoP).
                Edit the new revision's attributes and files on its part page;
                it stays hidden until this change order is released.
              </Trans>
            </p>
          )}

          {showBomBop &&
            (affected.makeMethod ? (
              <VStack spacing={2} className="w-full">
                <BillOfMaterial
                  key={`bom:${affected.makeMethod.id}`}
                  makeMethod={affected.makeMethod}
                  parentItemId={affected.draftItemId}
                  // @ts-expect-error mapped loader shape (mirrors the part route)
                  materials={affected.methodMaterials}
                  operations={affected.methodOperations}
                  configurable={affected.configurable}
                  configurationRules={affected.configurationRules}
                  parameters={affected.parameters}
                  replenishmentSystem={affected.replenishmentSystem}
                  revisionStatus={affected.revisionStatus}
                  releaseControl={affected.releaseControl ?? undefined}
                />
                <BillOfProcess
                  key={`bop:${affected.makeMethod.id}`}
                  makeMethod={affected.makeMethod}
                  materials={affected.methodMaterials}
                  // @ts-expect-error mapped loader shape (mirrors the part route)
                  operations={affected.methodOperations}
                  configurable={affected.configurable}
                  configurationRules={affected.configurationRules}
                  parameters={affected.parameters}
                  tags={affected.tags}
                  revisionStatus={affected.revisionStatus}
                  releaseControl={affected.releaseControl ?? undefined}
                />
              </VStack>
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                <Trans>No draft make method for this item yet.</Trans>
              </p>
            ))}
        </VStack>
      </CardContent>
    </Card>
  );
}

// Per-affected-item change-type selector. Switching rebuilds the CO-owned Draft
// for the new type (edits reset — Q2). Explicit Apply avoids accidental resets.
function ChangeTypeControl({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: ChangeOrderAffectedItemWithLabel;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffectedChangeType(changeOrderId, affected.id)}
      validator={changeOrderAffectedItemChangeTypeValidator}
      defaultValues={{ id: affected.id, changeType: affected.changeType }}
      className="w-full"
    >
      <Hidden name="id" value={affected.id} />
      <HStack className="w-full items-end gap-2">
        <div className="w-52">
          <Select
            name="changeType"
            label={t`Change type`}
            options={changeTypeOptions}
            isReadOnly={isDisabled}
          />
        </div>
        {!isDisabled && (
          <Submit isDisabled={fetcher.state !== "idle"}>
            <Trans>Apply</Trans>
          </Submit>
        )}
        <span className="text-xs text-muted-foreground pb-2">
          <Trans>Changing type resets this item's draft edits.</Trans>
        </span>
      </HStack>
    </ValidatedForm>
  );
}

function CutoverControl({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: ChangeOrderAffectedItemWithLabel;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffectedCutover(changeOrderId, affected.id)}
      validator={changeOrderAffectedItemCutoverValidator}
      defaultValues={{
        id: affected.id,
        supersessionMode: affected.supersessionMode,
        discontinuationDate: affected.discontinuationDate ?? "",
        successorEffectivityDate: affected.successorEffectivityDate ?? ""
      }}
      className="w-full"
    >
      <Hidden name="id" value={affected.id} />
      <VStack spacing={2}>
        <p className="text-xs text-muted-foreground">
          <Trans>
            This will create a new revision/part that supersedes the current
            one.
          </Trans>
        </p>
        <HStack className="w-full items-end gap-2 flex-wrap">
          <div className="w-52">
            <Select
              name="supersessionMode"
              label={t`Cutover mode`}
              options={supersessionModeOptions}
              isReadOnly={isDisabled}
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="discontinuationDate"
              label={t`Discontinuation date`}
              isDisabled={isDisabled}
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="successorEffectivityDate"
              label={t`Successor effectivity`}
              isDisabled={isDisabled}
            />
          </div>
          {!isDisabled && (
            <Submit isDisabled={fetcher.state !== "idle"}>
              <Trans>Save</Trans>
            </Submit>
          )}
        </HStack>
      </VStack>
    </ValidatedForm>
  );
}
