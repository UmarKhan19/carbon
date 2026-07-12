import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import { Boolean, Input, Select } from "~/components/Form";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { methodType, sourcingType } from "~/modules/shared";
import { path } from "~/utils/path";
import {
  deriveItemMethodUpdate,
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";

type StagedAttributes =
  Database["public"]["Tables"]["changeOrderStagedItemAttributes"]["Row"];

// The live item's current values — the "old" side of the redline.
type SourceAttributes = {
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

type ChangeOrderAttributesEditorProps = {
  changeOrderId: string;
  affectedId: string;
  staged: StagedAttributes;
  source: SourceAttributes;
  isDisabled: boolean;
};

const trackingTypeOptions = itemTrackingTypes.map((t) => ({
  value: t,
  label: t
}));
const methodTypeOptions = methodType.map((t) => ({ value: t, label: t }));
const replenishmentOptions = itemReplenishmentSystems.map((s) => ({
  value: s,
  label: s
}));
const sourcingTypeOptions = sourcingType.map((s) => ({ value: s, label: s }));

// Context-only validator — fields auto-save individually, this form is never
// submitted, so every field is optional.
const attributesFormValidator = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  unitOfMeasureCode: z.string().optional(),
  itemTrackingType: z.string().optional(),
  defaultMethodType: z.string().optional(),
  replenishmentSystem: z.string().optional(),
  sourcingType: z.string().optional()
});

// Subtle "was: X" indicator, shown only when the staged value differs from the
// live source value.
function WasHint({
  staged,
  source
}: {
  staged: string | null | undefined;
  source: string | null | undefined;
}) {
  const stagedValue = staged ?? "";
  const sourceValue = source ?? "";
  if (stagedValue === sourceValue) return null;
  return (
    <span className="text-xs text-muted-foreground line-through">
      <Trans>was: {sourceValue || "—"}</Trans>
    </span>
  );
}

export default function ChangeOrderAttributesEditor({
  changeOrderId,
  affectedId,
  staged,
  source,
  isDisabled
}: ChangeOrderAttributesEditorProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  // Every field edit POSTs the WHOLE staged attributes row (the action upserts
  // one row per affected item), so a change to one field never clobbers another.
  const onUpdate = useCallback(
    (patch: Partial<Record<keyof StagedAttributes, string | null>>) => {
      if (isDisabled) return;

      // Interlock: editing one of the three method/sourcing fields derives the
      // others (e.g. sourcing "Drop Ship" ⇒ method "Purchase to Order"), reusing
      // the SAME rule as the canonical item editor so a consistent triple is
      // always staged. Each select fires one field at a time, matching the
      // per-field shape of deriveItemMethodUpdate.
      let effectivePatch = patch;
      for (const f of [
        "replenishmentSystem",
        "defaultMethodType",
        "sourcingType"
      ] as const) {
        const v = patch[f];
        if (typeof v === "string" && v.length > 0) {
          effectivePatch = {
            ...patch,
            ...deriveItemMethodUpdate(f, v).itemUpdate
          };
          break;
        }
      }

      const formData = new FormData();
      formData.append("id", staged.id);
      formData.append("changeOrderId", changeOrderId);
      formData.append("affectedItemId", affectedId);

      const next = {
        name: staged.name,
        description: staged.description,
        unitOfMeasureCode: staged.unitOfMeasureCode,
        itemTrackingType: staged.itemTrackingType,
        defaultMethodType: staged.defaultMethodType,
        replenishmentSystem: staged.replenishmentSystem,
        sourcingType: staged.sourcingType,
        ...effectivePatch
      };

      formData.append("name", next.name ?? "");
      formData.append("description", next.description ?? "");
      formData.append("unitOfMeasureCode", next.unitOfMeasureCode ?? "");
      formData.append("itemTrackingType", next.itemTrackingType ?? "");
      formData.append("defaultMethodType", next.defaultMethodType ?? "");
      formData.append("replenishmentSystem", next.replenishmentSystem ?? "");
      formData.append("sourcingType", next.sourcingType ?? "");

      const requiresInspection =
        patch.requiresInspection !== undefined
          ? patch.requiresInspection
          : staged.requiresInspection
            ? "on"
            : "";
      if (requiresInspection === "on") {
        formData.append("requiresInspection", "on");
      }
      if (staged.thumbnailPath) {
        formData.append("thumbnailPath", staged.thumbnailPath);
      }

      fetcher.submit(formData, {
        method: "post",
        action: path.to.changeOrderStagedAttributes(changeOrderId, affectedId)
      });
    },
    [
      affectedId,
      changeOrderId,
      fetcher,
      isDisabled,
      staged.description,
      staged.defaultMethodType,
      staged.id,
      staged.itemTrackingType,
      staged.name,
      staged.replenishmentSystem,
      staged.requiresInspection,
      staged.sourcingType,
      staged.thumbnailPath,
      staged.unitOfMeasureCode
    ]
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Attributes</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* The ValidatedForm here only supplies the field context that
            useField needs — each field auto-saves via `onUpdate` (fetcher),
            so there is no Submit; this form is never itself submitted. */}
        <ValidatedForm
          validator={attributesFormValidator}
          defaultValues={{
            name: staged.name ?? "",
            description: staged.description ?? "",
            unitOfMeasureCode: staged.unitOfMeasureCode ?? "",
            itemTrackingType: staged.itemTrackingType ?? "",
            defaultMethodType: staged.defaultMethodType ?? "",
            replenishmentSystem: staged.replenishmentSystem ?? "",
            sourcingType: staged.sourcingType ?? ""
          }}
          className="w-full"
        >
          <VStack spacing={4}>
            <VStack spacing={1}>
              <Input
                name="name"
                label={t`Name`}
                defaultValue={staged.name ?? ""}
                isDisabled={isDisabled}
                onBlur={(e) => onUpdate({ name: e.target.value })}
              />
              <WasHint staged={staged.name} source={source.name} />
            </VStack>

            <VStack spacing={1}>
              <Input
                name="description"
                label={t`Description`}
                defaultValue={staged.description ?? ""}
                isDisabled={isDisabled}
                onBlur={(e) => onUpdate({ description: e.target.value })}
              />
              <WasHint
                staged={staged.description}
                source={source.description}
              />
            </VStack>

            <VStack spacing={1}>
              <Input
                name="unitOfMeasureCode"
                label={t`Unit of Measure`}
                defaultValue={staged.unitOfMeasureCode ?? ""}
                isDisabled={isDisabled}
                onBlur={(e) => onUpdate({ unitOfMeasureCode: e.target.value })}
              />
              <WasHint
                staged={staged.unitOfMeasureCode}
                source={source.unitOfMeasureCode}
              />
            </VStack>

            <VStack spacing={1}>
              <Select
                name="itemTrackingType"
                label={t`Tracking Type`}
                value={staged.itemTrackingType ?? undefined}
                options={trackingTypeOptions}
                isReadOnly={isDisabled}
                onChange={(v) =>
                  onUpdate({ itemTrackingType: v?.value ?? null })
                }
              />
              <WasHint
                staged={staged.itemTrackingType}
                source={source.itemTrackingType}
              />
            </VStack>

            <VStack spacing={1}>
              <Select
                name="defaultMethodType"
                label={t`Default Method Type`}
                value={staged.defaultMethodType ?? undefined}
                options={methodTypeOptions}
                isReadOnly={isDisabled}
                onChange={(v) =>
                  onUpdate({ defaultMethodType: v?.value ?? null })
                }
              />
              <WasHint
                staged={staged.defaultMethodType}
                source={source.defaultMethodType}
              />
            </VStack>

            <VStack spacing={1}>
              <Select
                name="replenishmentSystem"
                label={t`Replenishment`}
                value={staged.replenishmentSystem ?? undefined}
                options={replenishmentOptions}
                isReadOnly={isDisabled}
                onChange={(v) =>
                  onUpdate({ replenishmentSystem: v?.value ?? null })
                }
              />
              <WasHint
                staged={staged.replenishmentSystem}
                source={source.replenishmentSystem}
              />
            </VStack>

            {/* Sourcing only applies to "Buy and Make" items — matches the
                canonical item editor (SourcingTypeProperty). */}
            {staged.replenishmentSystem === "Buy and Make" && (
              <VStack spacing={1}>
                <Select
                  name="sourcingType"
                  label={t`Sourcing Type`}
                  value={staged.sourcingType ?? undefined}
                  options={sourcingTypeOptions}
                  isReadOnly={isDisabled}
                  onChange={(v) => onUpdate({ sourcingType: v?.value ?? null })}
                />
                <WasHint
                  staged={staged.sourcingType}
                  source={source.sourcingType}
                />
              </VStack>
            )}

            <VStack spacing={1}>
              <Boolean
                name="requiresInspection"
                label={t`Requires Inspection`}
                variant="small"
                value={staged.requiresInspection ?? false}
                isDisabled={isDisabled}
                onChange={(checked) =>
                  onUpdate({ requiresInspection: checked ? "on" : "" })
                }
              />
              {(staged.requiresInspection ?? false) !==
                (source.requiresInspection ?? false) && (
                <span className="text-xs text-muted-foreground line-through">
                  <Trans>
                    was: {source.requiresInspection ? t`Yes` : t`No`}
                  </Trans>
                </span>
              )}
            </VStack>

            <VStack spacing={2}>
              <h3 className="text-xs text-muted-foreground">
                <Trans>Thumbnail</Trans>
              </h3>
              <ItemThumbnailUpload
                path={source.thumbnailPath}
                itemId={source.itemId}
                modelId={source.modelId}
              />
            </VStack>
          </VStack>
        </ValidatedForm>
      </CardContent>
    </Card>
  );
}
