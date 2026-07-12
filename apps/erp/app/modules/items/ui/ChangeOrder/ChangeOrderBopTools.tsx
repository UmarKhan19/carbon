import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import { HStack, IconButton, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Number, Submit, Tool } from "~/components/Form";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { changeOrderStagedOperationToolValidator } from "../../changeOrder.models";
import {
  buildDiffMap,
  DiffBadge,
  RemovedEntryRow,
  removedEntries
} from "./diff-ui";

type StagedTool =
  Database["public"]["Tables"]["changeOrderStagedOperationTool"]["Row"];
type ChildDiff = MethodDiffEntry<Record<string, unknown>>;

export function ToolsPanel({
  changeOrderId,
  affectedId,
  operationId,
  tools,
  diff,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  tools: StagedTool[];
  diff?: ChildDiff[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const diffMap = buildDiffMap(diff);
  const presentIds = new Set(tools.map((tool) => tool.id));
  const removed = removedEntries(diff, presentIds);

  return (
    <VStack spacing={2} className="pt-2">
      {tools.length === 0 && removed.length === 0 && (
        <p className="text-sm text-muted-foreground py-1">
          <Trans>No tools.</Trans>
        </p>
      )}
      {tools.map((tool) => (
        <ToolRow
          key={tool.id}
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          tool={tool}
          status={diffMap.get(tool.id)?.status}
          isDisabled={isDisabled}
        />
      ))}
      {removed.map((entry, i) => {
        const before = entry.before as { id?: string; toolId?: string } | null;
        return (
          <RemovedEntryRow
            key={before?.id ?? `removed-tool-${i}`}
            label={before?.toolId || t`Tool`}
          />
        );
      })}
      {!isDisabled && (
        <ToolFormRow
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
        />
      )}
    </VStack>
  );
}

function ToolRow({
  changeOrderId,
  affectedId,
  operationId,
  tool,
  status,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  tool: StagedTool;
  status?: ChildDiff["status"];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  return (
    <div className="w-full border border-border rounded-lg p-3">
      <HStack className="w-full justify-between mb-2">
        {status && <DiffBadge status={status} />}
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderStagedOperationTool(
              changeOrderId,
              affectedId,
              operationId,
              tool.id
            )}
            className="ml-auto"
          >
            <IconButton
              type="submit"
              aria-label={t`Remove tool`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperationTool(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationToolValidator}
        defaultValues={{
          id: tool.id,
          changeOrderId,
          stagedOperationId: operationId,
          toolId: tool.toolId,
          quantity: tool.quantity
        }}
        className="w-full"
      >
        <Hidden name="id" value={tool.id} />
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <div className="grid w-full gap-x-6 gap-y-3 grid-cols-1 lg:grid-cols-2">
          <Tool name="toolId" label={t`Tool`} />
          <Number name="quantity" label={t`Quantity`} minValue={0} />
        </div>
        <HStack className="w-full justify-end mt-2">
          <Submit
            isDisabled={isDisabled || fetcher.state !== "idle"}
            isLoading={fetcher.state === "submitting"}
          >
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>
    </div>
  );
}

function ToolFormRow({
  changeOrderId,
  affectedId,
  operationId
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  return (
    <div className="w-full border border-dashed border-border rounded-lg p-3">
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperationTool(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationToolValidator}
        defaultValues={{
          changeOrderId,
          stagedOperationId: operationId,
          toolId: "",
          quantity: 1
        }}
        className="w-full"
        resetAfterSubmit
      >
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <div className="grid w-full gap-x-6 gap-y-3 grid-cols-1 lg:grid-cols-2">
          <Tool name="toolId" label={t`Tool`} />
          <Number name="quantity" label={t`Quantity`} minValue={0} />
        </div>
        <HStack className="w-full justify-end mt-2">
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add Tool</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>
    </div>
  );
}
