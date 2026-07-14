import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Status,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
import type { SupersessionMode } from "../../items.models";
import { supersessionModeMeta, supersessionModes } from "../../items.models";
import { BillOfMaterial, BillOfProcess } from "../Item";
import PartProperties from "../Parts/PartProperties";
import type { AffectedItemDraft } from "./AffectedItems";
import ItemLink from "./ItemLink";

const supersessionModeOptions = supersessionModes.map((value) => ({
  value,
  label: <Status color={supersessionModeMeta[value].color}>{value}</Status>
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
  // Change-type availability keys off the SOURCE item: a Version is a method
  // version of the affected part itself, meaningless when that part is purchased.
  const sourceIsManufactured = label?.replenishmentSystem !== "Buy";
  // BoM/BoP visibility keys off the item actually being edited/released — for a
  // New Part that's the new item (whose replenishment the user can flip in the
  // Properties tab), for a Version it's the same source item. So switching a New
  // Part's replenishment Buy↔Make shows/hides its BoM/BoP after revalidation.
  const draftIsManufactured =
    (affected.partData?.partSummary?.replenishmentSystem ??
      label?.replenishmentSystem) !== "Buy";
  // Q2 capability matrix: Version = BoM/BoP only; Revision = attrs/docs only (no
  // BoM/BoP); New Part = both. Version has no supersession (same item).
  const showBomBop =
    (changeType === "Version" || changeType === "New Part") &&
    draftIsManufactured;
  const showAttributes = changeType === "Revision" || changeType === "New Part";
  const showCutover = changeType !== "Version";
  // A purchased item under a type that would otherwise expose BoM/BoP: explain it.
  const showBuyNote =
    !draftIsManufactured &&
    (changeType === "Version" || changeType === "New Part");

  // Rendered in the Version flat layout and inside the Revision/New Part tab, so
  // build it once.
  const methodEditors = showBomBop ? (
    affected.makeMethod ? (
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
          replenishmentSystem={label?.replenishmentSystem ?? undefined}
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
    )
  ) : null;

  return (
    // Collapsible so a CO with many affected items stays scannable — the header
    // (id + change type) stays visible when collapsed; the built-in chevron and
    // clicking a collapsed header both toggle it.
    <Card className="w-full" isCollapsible>
      <CardHeader>
        <HStack spacing={2}>
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
          <Badge variant="secondary">{changeType}</Badge>
        </HStack>
        {label?.name && (
          <span className="text-xs text-muted-foreground">{label.name}</span>
        )}
      </CardHeader>
      {/* Sits just left of the Card's absolute collapse chevron (right-2), top-
          aligned with it, so both controls line up in the top-right corner. */}
      {!isDisabled && (
        <removeFetcher.Form
          method="post"
          action={path.to.deleteChangeOrderAffected(
            changeOrderId,
            affectedItem.id
          )}
          className="absolute right-12 top-2"
        >
          <IconButton
            type="submit"
            aria-label={t`Remove affected item`}
            variant="ghost"
            icon={<LuTrash2 />}
          />
        </removeFetcher.Form>
      )}
      <CardContent>
        <VStack spacing={4}>
          <ChangeTypeControl
            changeOrderId={changeOrderId}
            affected={affectedItem}
            isManufactured={sourceIsManufactured}
            isDisabled={isDisabled}
          />

          {showBuyNote && (
            <p className="text-sm text-muted-foreground">
              <Trans>
                This is a purchased item — it has no BoM/BoP; only its
                attributes and documents can change.
              </Trans>
            </p>
          )}

          {showAttributes ? (
            // Revision / New Part edit two distinct surfaces — split them into
            // tabs so the tall attribute editor and the method/cutover don't
            // stack into one long scroll.
            <Tabs defaultValue="properties" className="w-full">
              <TabsList>
                <TabsTrigger value="properties">
                  <Trans>Properties</Trans>
                </TabsTrigger>
                <TabsTrigger value="manufacturing">
                  <Trans>Manufacturing</Trans>
                </TabsTrigger>
                <TabsTrigger value="files">
                  <Trans>Files</Trans>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="properties" className="pt-2">
                {affected.partData ? (
                  <PartProperties
                    embedded
                    section="properties"
                    data={affected.partData}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    <Trans>No editable properties for this item.</Trans>
                  </p>
                )}
              </TabsContent>
              <TabsContent value="manufacturing" className="pt-2">
                <VStack spacing={4}>
                  {methodEditors}
                  {showCutover && (
                    <CutoverControl
                      changeOrderId={changeOrderId}
                      affected={affectedItem}
                      isDisabled={isDisabled}
                    />
                  )}
                </VStack>
              </TabsContent>
              <TabsContent value="files" className="pt-2">
                {affected.partData ? (
                  <PartProperties
                    embedded
                    section="files"
                    data={affected.partData}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    <Trans>No files for this item.</Trans>
                  </p>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            methodEditors
          )}
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
  isManufactured,
  isDisabled
}: {
  changeOrderId: string;
  affected: ChangeOrderAffectedItemWithLabel;
  isManufactured: boolean;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  // Track the picked value so the Apply button (and its "resets edits" warning)
  // only appear once the user selects a type different from the saved one.
  const [selected, setSelected] = useState<string>(affected.changeType);
  const hasChanged = selected !== affected.changeType;
  // Version = a manufacturing-method change, meaningless for a Buy item — don't
  // offer it there (Buy items default to Revision on add).
  const options = isManufactured
    ? changeTypeOptions
    : changeTypeOptions.filter((o) => o.value !== "Version");

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
            termId="change-order-change-type"
            options={options}
            isReadOnly={isDisabled}
            onChange={(option) =>
              setSelected(option?.value ?? affected.changeType)
            }
          />
        </div>
        {!isDisabled && hasChanged && (
          <>
            <Submit isDisabled={fetcher.state !== "idle"}>
              <Trans>Apply</Trans>
            </Submit>
            <span className="text-xs text-muted-foreground pb-2">
              <Trans>Changing type resets this item's draft edits.</Trans>
            </span>
          </>
        )}
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
  // Drives the mode-description helper text, reusing the canonical supersession
  // presentation so the CO cutover matches the item supersession form exactly.
  const [mode, setMode] = useState<SupersessionMode | "">(
    (affected.supersessionMode as SupersessionMode | null) ?? ""
  );

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
        <HStack className="w-full items-end gap-2 flex-wrap">
          <div className="w-52">
            <Select
              name="supersessionMode"
              label={t`Supersession Mode`}
              termId="supersession-mode"
              options={supersessionModeOptions}
              isReadOnly={isDisabled}
              helperText={
                mode ? supersessionModeMeta[mode].description : undefined
              }
              onChange={(option) =>
                setMode((option?.value as SupersessionMode) ?? "")
              }
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="discontinuationDate"
              label={t`Discontinuation date`}
              helperText={t`Stop raising purchase orders after this date`}
              isDisabled={isDisabled}
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="successorEffectivityDate"
              label={t`Successor effectivity`}
              helperText={t`When MRP uses the successor for new demand`}
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
