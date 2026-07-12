import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import { HStack, IconButton, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Input, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { changeOrderStagedOperationParameterValidator } from "../../changeOrder.models";
import {
  buildDiffMap,
  DiffBadge,
  RemovedEntryRow,
  removedEntries
} from "./diff-ui";

type StagedParameter =
  Database["public"]["Tables"]["changeOrderStagedOperationParameter"]["Row"];
type ChildDiff = MethodDiffEntry<Record<string, unknown>>;

export function ParametersPanel({
  changeOrderId,
  affectedId,
  operationId,
  parameters,
  diff,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  parameters: StagedParameter[];
  diff?: ChildDiff[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const diffMap = buildDiffMap(diff);
  const presentIds = new Set(parameters.map((p) => p.id));
  const removed = removedEntries(diff, presentIds);

  return (
    <VStack spacing={2} className="pt-2">
      {parameters.length === 0 && removed.length === 0 && (
        <p className="text-sm text-muted-foreground py-1">
          <Trans>No parameters.</Trans>
        </p>
      )}
      {parameters.map((parameter) => (
        <ParameterRow
          key={parameter.id}
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          parameter={parameter}
          status={diffMap.get(parameter.id)?.status}
          isDisabled={isDisabled}
        />
      ))}
      {removed.map((entry, i) => {
        const before = entry.before as { id?: string; key?: string } | null;
        return (
          <RemovedEntryRow
            key={before?.id ?? `removed-param-${i}`}
            label={before?.key || t`Parameter`}
          />
        );
      })}
      {!isDisabled && (
        <ParameterForm
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
        />
      )}
    </VStack>
  );
}

function ParameterRow({
  changeOrderId,
  affectedId,
  operationId,
  parameter,
  status,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  parameter: StagedParameter;
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
            action={path.to.deleteChangeOrderStagedOperationParameter(
              changeOrderId,
              affectedId,
              operationId,
              parameter.id
            )}
            className="ml-auto"
          >
            <IconButton
              type="submit"
              aria-label={t`Remove parameter`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperationParameter(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationParameterValidator}
        defaultValues={{
          id: parameter.id,
          changeOrderId,
          stagedOperationId: operationId,
          key: parameter.key,
          value: parameter.value
        }}
        className="w-full"
      >
        <Hidden name="id" value={parameter.id} />
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <div className="grid w-full gap-x-6 gap-y-3 grid-cols-1 lg:grid-cols-2">
          <Input name="key" label={t`Key`} isDisabled={isDisabled} />
          <Input name="value" label={t`Value`} isDisabled={isDisabled} />
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

function ParameterForm({
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
        action={path.to.changeOrderStagedOperationParameter(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationParameterValidator}
        defaultValues={{
          changeOrderId,
          stagedOperationId: operationId,
          key: "",
          value: ""
        }}
        className="w-full"
        resetAfterSubmit
      >
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <div className="grid w-full gap-x-6 gap-y-3 grid-cols-1 lg:grid-cols-2">
          <Input name="key" label={t`Key`} />
          <Input name="value" label={t`Value`} />
        </div>
        <HStack className="w-full justify-end mt-2">
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add Parameter</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>
    </div>
  );
}
