import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Item, Number, Submit } from "~/components/Form";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { changeOrderStagedMaterialValidator } from "../../changeOrder.models";

type StagedMaterial =
  Database["public"]["Tables"]["changeOrderStagedMaterial"]["Row"];

// A material diff entry: rows are compared as generic records (the diff engine is
// generic over row shape); we only read `.id` off the before/after payloads.
type MaterialDiff = MethodDiffEntry<Record<string, unknown>>;

type ChangeOrderBomEditorProps = {
  changeOrderId: string;
  affectedId: string;
  materials: StagedMaterial[];
  diff?: MaterialDiff[];
  isDisabled: boolean;
};

// Map each staged material id → its diff status. A staged row is the diff
// `after`; a removed line only exists as a `before` (no staged row), so those
// are rendered separately below the staged lines.
function buildDiffMap(diff?: MaterialDiff[]): Map<string, MaterialDiff> {
  const map = new Map<string, MaterialDiff>();
  if (!diff) return map;
  for (const entry of diff) {
    const afterId = (entry.after as { id?: string } | null)?.id;
    if (afterId) map.set(afterId, entry);
  }
  return map;
}

function DiffBadge({ status }: { status: MethodDiffEntry<unknown>["status"] }) {
  if (status === "added") {
    return (
      <Badge variant="green">
        <Trans>Added</Trans>
      </Badge>
    );
  }
  if (status === "modified") {
    return (
      <Badge variant="yellow">
        <Trans>Modified</Trans>
      </Badge>
    );
  }
  if (status === "removed") {
    return (
      <Badge variant="red">
        <Trans>Removed</Trans>
      </Badge>
    );
  }
  return null;
}

export default function ChangeOrderBomEditor({
  changeOrderId,
  affectedId,
  materials,
  diff,
  isDisabled
}: ChangeOrderBomEditorProps) {
  const { t } = useLingui();
  const [items] = useItems();

  const diffMap = buildDiffMap(diff);

  // Removed lines have a diff `before` but no matching staged material.
  const stagedIds = new Set(materials.map((m) => m.id));
  const removedEntries = (diff ?? []).filter((entry) => {
    if (entry.status !== "removed") return false;
    const beforeId = (entry.before as { id?: string } | null)?.id;
    return beforeId ? !stagedIds.has(beforeId) : true;
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Bill of Material</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          {materials.length === 0 && removedEntries.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              <Trans>No materials staged for this item.</Trans>
            </p>
          )}

          {materials
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((material) => (
              <BomLine
                key={material.id}
                changeOrderId={changeOrderId}
                affectedId={affectedId}
                material={material}
                status={diffMap.get(material.id)?.status}
                isDisabled={isDisabled}
              />
            ))}

          {removedEntries.map((entry, index) => {
            const before = entry.before as {
              id?: string;
              itemId?: string;
              quantity?: number | string;
            } | null;
            return (
              <HStack
                key={before?.id ?? `removed-${index}`}
                className="w-full justify-between border border-border rounded-lg p-3 opacity-60"
              >
                <HStack spacing={2}>
                  <span className="text-sm font-medium line-through">
                    {getItemReadableId(items, before?.itemId ?? "") ??
                      before?.itemId ??
                      t`Unknown item`}
                  </span>
                  <Badge variant="secondary" className="tabular-nums">
                    {String(before?.quantity ?? "")}
                  </Badge>
                </HStack>
                <DiffBadge status="removed" />
              </HStack>
            );
          })}

          {!isDisabled && (
            <NewBomLine changeOrderId={changeOrderId} affectedId={affectedId} />
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function BomLine({
  changeOrderId,
  affectedId,
  material,
  status,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  material: StagedMaterial;
  status?: MethodDiffEntry<unknown>["status"];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const quantityFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const readableId =
    getItemReadableId(items, material.itemId) ?? material.itemId;

  const onQuantityChange = (next: number) => {
    if (isDisabled) return;
    if (
      globalThis.Number.isNaN(next) ||
      next <= 0 ||
      next === material.quantity
    )
      return;
    const formData = new FormData();
    formData.append("id", material.id);
    formData.append("changeOrderId", changeOrderId);
    formData.append("affectedItemId", affectedId);
    formData.append("itemId", material.itemId);
    formData.append("quantity", String(next));
    formData.append("order", String(material.order));
    if (material.unitOfMeasureCode) {
      formData.append("unitOfMeasureCode", material.unitOfMeasureCode);
    }
    if (material.sourceMaterialId) {
      formData.append("sourceMaterialId", material.sourceMaterialId);
    }
    quantityFetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderStagedMaterial(changeOrderId, affectedId)
    });
  };

  return (
    <HStack
      className={cn(
        "w-full justify-between border border-border rounded-lg p-3",
        status === "added" && "border-l-2 border-l-emerald-500",
        status === "modified" && "border-l-2 border-l-amber-500"
      )}
    >
      <HStack spacing={2}>
        <span className="text-sm font-medium truncate">{readableId}</span>
        {status && <DiffBadge status={status} />}
      </HStack>
      <HStack spacing={2}>
        <div className="w-28">
          <Number
            name={`quantity-${material.id}`}
            label={t`Quantity`}
            defaultValue={material.quantity}
            minValue={0}
            isDisabled={isDisabled || quantityFetcher.state !== "idle"}
            onChange={onQuantityChange}
          />
        </div>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderStagedMaterial(
              changeOrderId,
              affectedId,
              material.id
            )}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove material`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>
    </HStack>
  );
}

function NewBomLine({
  changeOrderId,
  affectedId
}: {
  changeOrderId: string;
  affectedId: string;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderStagedMaterial(changeOrderId, affectedId)}
      validator={changeOrderStagedMaterialValidator}
      defaultValues={{
        changeOrderId,
        affectedItemId: affectedId,
        itemId: "",
        quantity: 1
      }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={changeOrderId} />
      <Hidden name="affectedItemId" value={affectedId} />
      <HStack className="w-full items-end gap-2">
        <div className="flex-grow">
          <Item
            name="itemId"
            label={t`Add material`}
            type="Part"
            validItemTypes={["Consumable", "Material", "Part"]}
          />
        </div>
        <div className="w-28">
          <Number name="quantity" label={t`Quantity`} minValue={0} />
        </div>
        <Submit leftIcon={<LuPlus />}>
          <Trans>Add</Trans>
        </Submit>
      </HStack>
    </ValidatedForm>
  );
}
