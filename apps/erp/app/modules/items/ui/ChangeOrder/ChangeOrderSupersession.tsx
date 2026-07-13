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
import { LuArrowRight, LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DatePicker, Hidden, Item, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderSupersessionValidator } from "../../changeOrder.models";
import type { ChangeOrderSupersessionWithLabels } from "../../changeOrder.service";
import { supersessionModes } from "../../items.models";
import ItemLink from "./ItemLink";

const supersessionModeOptions = supersessionModes.map((m) => ({
  value: m,
  label: m
}));

// Manual different-part obsolescence declarations. This is NOT the per-affected-
// item revision cutover (which lives on each AffectedItemCard) — it is for
// replacing one part with a genuinely different part at release.
export default function ChangeOrderSupersession({
  id,
  supersessions,
  isDisabled
}: {
  id: string;
  supersessions: ChangeOrderSupersessionWithLabels[];
  isDisabled: boolean;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Supersessions</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          <Trans>
            Replace one part with a different part. For a revision bump of the
            same part, use the cutover on the affected item above.
          </Trans>
        </span>
      </CardHeader>
      <CardContent>
        <VStack spacing={3}>
          {supersessions.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              <Trans>No supersessions declared.</Trans>
            </span>
          ) : (
            supersessions.map((supersession) => (
              <SupersessionRow
                key={supersession.id}
                changeOrderId={id}
                supersession={supersession}
                isDisabled={isDisabled}
              />
            ))
          )}

          {!isDisabled && <NewSupersession id={id} />}
        </VStack>
      </CardContent>
    </Card>
  );
}

function SupersessionRow({
  changeOrderId,
  supersession,
  isDisabled
}: {
  changeOrderId: string;
  supersession: ChangeOrderSupersessionWithLabels;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const predecessor = supersession.predecessorItem;
  const successor = supersession.successorItem;

  return (
    <HStack className="w-full justify-between border border-border rounded-lg p-3">
      <HStack spacing={3}>
        <ItemLink
          itemId={supersession.predecessorItemId}
          type={predecessor?.type}
          className="text-sm font-medium"
        >
          {predecessor?.readableIdWithRevision ??
            predecessor?.readableId ??
            supersession.predecessorItemId}
        </ItemLink>
        <LuArrowRight className="text-muted-foreground" />
        {supersession.successorItemId ? (
          <ItemLink
            itemId={supersession.successorItemId}
            type={successor?.type}
            className="text-sm font-medium"
          >
            {successor?.readableIdWithRevision ??
              successor?.readableId ??
              supersession.successorItemId}
          </ItemLink>
        ) : (
          <span className="text-sm text-muted-foreground italic">
            <Trans>Discontinued</Trans>
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {supersession.supersessionMode}
        </span>
      </HStack>
      {!isDisabled && (
        <deleteFetcher.Form
          method="post"
          action={path.to.deleteChangeOrderSupersession(
            changeOrderId,
            supersession.id
          )}
        >
          <IconButton
            type="submit"
            aria-label={t`Remove supersession`}
            variant="ghost"
            icon={<LuTrash2 />}
          />
        </deleteFetcher.Form>
      )}
    </HStack>
  );
}

function NewSupersession({ id }: { id: string }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderSupersession(id)}
      validator={changeOrderSupersessionValidator}
      defaultValues={{
        changeOrderId: id,
        predecessorItemId: "",
        successorItemId: "",
        supersessionMode: "Consume First",
        discontinuationDate: "",
        successorEffectivityDate: ""
      }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={id} />
      <VStack spacing={2}>
        <HStack className="w-full items-end gap-2 flex-wrap">
          <div className="flex-grow min-w-48">
            <Item
              name="predecessorItemId"
              label={t`Predecessor`}
              type="Item"
              includeInactive
            />
          </div>
          <div className="flex-grow min-w-48">
            <Item
              name="successorItemId"
              label={t`Successor (optional)`}
              type="Item"
            />
          </div>
          <div className="w-48">
            <Select
              name="supersessionMode"
              label={t`Mode`}
              options={supersessionModeOptions}
            />
          </div>
        </HStack>
        <HStack className="w-full items-end gap-2 flex-wrap">
          <div className="w-44">
            <DatePicker
              name="discontinuationDate"
              label={t`Discontinuation date`}
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="successorEffectivityDate"
              label={t`Successor effectivity`}
            />
          </div>
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add</Trans>
          </Submit>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
}
