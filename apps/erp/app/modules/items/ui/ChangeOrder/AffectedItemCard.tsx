import { ValidatedForm } from "@carbon/form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
import { changeOrderAffectedItemCutoverValidator } from "../../changeOrder.models";
import type { ChangeOrderAffectedItemWithLabel } from "../../changeOrder.staging";
import { supersessionModes } from "../../items.models";
import type { AffectedItemStaging } from "./AffectedItems";
import ChangeOrderAttributesEditor from "./ChangeOrderAttributesEditor";
import ChangeOrderBomEditor from "./ChangeOrderBomEditor";
import ChangeOrderBopEditor from "./ChangeOrderBopEditor";
import ItemLink from "./ItemLink";

const supersessionModeOptions = supersessionModes.map((m) => ({
  value: m,
  label: m
}));

// One expandable card per affected item: header (item link + remove), the
// per-item revision cutover control, and an expander revealing the staged
// BOM / BOP / attributes editors.
export default function AffectedItemCard({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: AffectedItemStaging;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const removeFetcher = useFetcher<{ success: boolean }>();

  const affectedItem: ChangeOrderAffectedItemWithLabel = affected.affectedItem;
  const label = affectedItem.item;

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
          <CutoverControl
            changeOrderId={changeOrderId}
            affected={affectedItem}
            isDisabled={isDisabled}
          />

          <Accordion type="multiple" className="w-full">
            <AccordionItem value="bom">
              <AccordionTrigger>
                <Trans>Bill of Material</Trans>
              </AccordionTrigger>
              <AccordionContent>
                <ChangeOrderBomEditor
                  changeOrderId={changeOrderId}
                  affectedId={affectedItem.id}
                  materials={affected.materials}
                  diff={affected.diff?.materials}
                  isDisabled={isDisabled}
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="bop">
              <AccordionTrigger>
                <Trans>Bill of Process</Trans>
              </AccordionTrigger>
              <AccordionContent>
                <ChangeOrderBopEditor
                  changeOrderId={changeOrderId}
                  affectedId={affectedItem.id}
                  operations={affected.operations}
                  diff={affected.diff?.operations}
                  isDisabled={isDisabled}
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="attributes">
              <AccordionTrigger>
                <Trans>Attributes</Trans>
              </AccordionTrigger>
              <AccordionContent>
                {affected.attributes ? (
                  <ChangeOrderAttributesEditor
                    changeOrderId={changeOrderId}
                    affectedId={affectedItem.id}
                    staged={affected.attributes}
                    source={affected.source}
                    isDisabled={isDisabled}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    <Trans>No staged attributes for this item.</Trans>
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </VStack>
      </CardContent>
    </Card>
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
            This will create a new revision that supersedes the current one.
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
