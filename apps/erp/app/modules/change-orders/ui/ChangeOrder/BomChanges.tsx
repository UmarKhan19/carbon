import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Input, Item, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderBomChangeValidator } from "../../change-orders.models";
import BomChangeAddRow from "./BomChangeAddRow";
import type { BomChangeAssembly } from "./BomChangeAssemblyTable";
import BomChangeDeleteRow from "./BomChangeDeleteRow";

export type BomChangeRow = {
  id: string;
  changeType: "Add" | "Delete";
  itemId: string | null;
  item: {
    id: string;
    readableIdWithRevision: string | null;
    name: string | null;
    type: string | null;
    active: boolean | null;
    revisionStatus: string | null;
  } | null;
  assemblies: BomChangeAssembly[] | null;
};

export default function BomChanges({
  changeOrderId,
  rows,
  isDisabled
}: {
  changeOrderId: string;
  rows: BomChangeRow[];
  isDisabled: boolean;
}) {
  const deleteRows = rows.filter((r) => r.changeType === "Delete");
  const addRows = rows.filter((r) => r.changeType === "Add");

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>BOM Changes</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <DeleteSection
            changeOrderId={changeOrderId}
            rows={deleteRows}
            isDisabled={isDisabled}
          />
          <AddSection
            changeOrderId={changeOrderId}
            rows={addRows}
            isDisabled={isDisabled}
          />
        </VStack>
      </CardContent>
    </Card>
  );
}

function DeleteSection({
  changeOrderId,
  rows,
  isDisabled
}: {
  changeOrderId: string;
  rows: BomChangeRow[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const addFetcher = useFetcher<{ success: boolean }>();

  const existing = rows.map((r) => r.itemId).filter(Boolean) as string[];

  return (
    <VStack spacing={2}>
      <h3 className="text-xs text-muted-foreground uppercase tracking-wide">
        <Trans>Delete parts</Trans>
      </h3>
      {rows.length === 0 ? (
        <span className="text-sm text-muted-foreground italic">
          <Trans>No parts to delete.</Trans>
        </span>
      ) : (
        rows.map((row) => (
          <BomChangeDeleteRow
            key={row.id}
            changeOrderId={changeOrderId}
            row={row}
            isDisabled={isDisabled}
          />
        ))
      )}

      {!isDisabled && (
        <ValidatedForm
          fetcher={addFetcher}
          method="post"
          action={path.to.changeOrderBomChange(changeOrderId)}
          validator={changeOrderBomChangeValidator}
          defaultValues={{
            changeType: "Delete",
            changeOrderId,
            itemId: ""
          }}
          className="w-full"
          resetAfterSubmit
        >
          <Hidden name="changeType" value="Delete" />
          <Hidden name="changeOrderId" value={changeOrderId} />
          <HStack className="w-full items-end gap-2">
            <div className="flex-grow">
              <Item
                name="itemId"
                label={t`Add delete row`}
                type="Item"
                blacklist={existing}
                includeInactive
              />
            </div>
            <Submit leftIcon={<LuPlus />}>
              <Trans>Add</Trans>
            </Submit>
          </HStack>
        </ValidatedForm>
      )}
    </VStack>
  );
}

function AddSection({
  changeOrderId,
  rows,
  isDisabled
}: {
  changeOrderId: string;
  rows: BomChangeRow[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const existingFetcher = useFetcher<{ success: boolean }>();
  const newFetcher = useFetcher<{ success: boolean }>();
  const [showNewPart, setShowNewPart] = useState(false);

  const existing = rows.map((r) => r.itemId).filter(Boolean) as string[];

  return (
    <VStack spacing={2}>
      <h3 className="text-xs text-muted-foreground uppercase tracking-wide">
        <Trans>Add parts</Trans>
      </h3>
      {rows.length === 0 ? (
        <span className="text-sm text-muted-foreground italic">
          <Trans>No parts to add.</Trans>
        </span>
      ) : (
        rows.map((row) => (
          <BomChangeAddRow
            key={row.id}
            changeOrderId={changeOrderId}
            row={row}
            isDisabled={isDisabled}
          />
        ))
      )}

      {!isDisabled && (
        <VStack spacing={2} className="w-full">
          <HStack className="w-full justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNewPart((v) => !v)}
            >
              {showNewPart ? (
                <Trans>Pick existing part</Trans>
              ) : (
                <Trans>New part (not yet synced)</Trans>
              )}
            </Button>
          </HStack>

          {showNewPart ? (
            <ValidatedForm
              key="new-part"
              fetcher={newFetcher}
              method="post"
              action={path.to.changeOrderBomChange(changeOrderId)}
              validator={changeOrderBomChangeValidator}
              defaultValues={{
                changeType: "Add",
                changeOrderId,
                newItemReadableId: "",
                newItemName: ""
              }}
              className="w-full"
              resetAfterSubmit
            >
              <Hidden name="changeType" value="Add" />
              <Hidden name="changeOrderId" value={changeOrderId} />
              <HStack className="w-full items-end gap-2">
                <div className="flex-grow">
                  <Input name="newItemReadableId" label={t`New part id`} />
                </div>
                <div className="flex-grow">
                  <Input name="newItemName" label={t`New part name`} />
                </div>
                <Submit leftIcon={<LuPlus />}>
                  <Trans>Add</Trans>
                </Submit>
              </HStack>
            </ValidatedForm>
          ) : (
            <ValidatedForm
              key="existing-part"
              fetcher={existingFetcher}
              method="post"
              action={path.to.changeOrderBomChange(changeOrderId)}
              validator={changeOrderBomChangeValidator}
              defaultValues={{
                changeType: "Add",
                changeOrderId,
                itemId: ""
              }}
              className="w-full"
              resetAfterSubmit
            >
              <Hidden name="changeType" value="Add" />
              <Hidden name="changeOrderId" value={changeOrderId} />
              <HStack className="w-full items-end gap-2">
                <div className="flex-grow">
                  <Item
                    name="itemId"
                    label={t`Add add row`}
                    type="Item"
                    blacklist={existing}
                  />
                </div>
                <Submit leftIcon={<LuPlus />}>
                  <Trans>Add</Trans>
                </Submit>
              </HStack>
            </ValidatedForm>
          )}
        </VStack>
      )}
    </VStack>
  );
}
