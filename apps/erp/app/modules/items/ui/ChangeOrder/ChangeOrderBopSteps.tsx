import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import { HStack, IconButton, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Boolean as BooleanField,
  Hidden,
  Input,
  Number,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure
} from "~/components/Form";
import { procedureStepType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { changeOrderStagedOperationStepValidator } from "../../changeOrder.models";
import {
  buildDiffMap,
  DiffBadge,
  RemovedEntryRow,
  removedEntries
} from "./diff-ui";

type StagedStep =
  Database["public"]["Tables"]["changeOrderStagedOperationStep"]["Row"];
type ChildDiff = MethodDiffEntry<Record<string, unknown>>;

const stepTypeOptions = procedureStepType.map((s) => ({ value: s, label: s }));

export function StepsPanel({
  changeOrderId,
  affectedId,
  operationId,
  steps,
  diff,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  steps: StagedStep[];
  diff?: ChildDiff[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const diffMap = buildDiffMap(diff);
  const presentIds = new Set(steps.map((s) => s.id));
  const removed = removedEntries(diff, presentIds);
  const nextOrder =
    steps.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), 0) + 1;

  return (
    <VStack spacing={2} className="pt-2">
      {steps.length === 0 && removed.length === 0 && (
        <p className="text-sm text-muted-foreground py-1">
          <Trans>No steps.</Trans>
        </p>
      )}
      {steps
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((step) => (
          <StepRow
            key={step.id}
            changeOrderId={changeOrderId}
            affectedId={affectedId}
            operationId={operationId}
            step={step}
            status={diffMap.get(step.id)?.status}
            isDisabled={isDisabled}
          />
        ))}
      {removed.map((entry, i) => {
        const before = entry.before as { id?: string; name?: string } | null;
        return (
          <RemovedEntryRow
            key={before?.id ?? `removed-step-${i}`}
            label={before?.name || t`Step`}
          />
        );
      })}
      {!isDisabled && (
        <StepForm
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          nextOrder={nextOrder}
        />
      )}
    </VStack>
  );
}

function StepFields({ isDisabled }: { isDisabled: boolean }) {
  const { t } = useLingui();
  return (
    <div className="grid w-full gap-x-6 gap-y-3 grid-cols-1 lg:grid-cols-2">
      <Input name="name" label={t`Name`} isDisabled={isDisabled} />
      <Select
        name="type"
        label={t`Type`}
        options={stepTypeOptions}
        isReadOnly={isDisabled}
      />
      <TextArea
        name="description"
        label={t`Description`}
        className="lg:col-span-2"
      />
      <UnitOfMeasure name="unitOfMeasureCode" label={t`Unit of Measure`} />
      <Number name="sortOrder" label={t`Sort Order`} minValue={0} />
      <Number name="minValue" label={t`Min Value`} />
      <Number name="maxValue" label={t`Max Value`} />
      <BooleanField name="required" label={t`Required`} />
    </div>
  );
}

function StepRow({
  changeOrderId,
  affectedId,
  operationId,
  step,
  status,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  step: StagedStep;
  status?: ChildDiff["status"];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  return (
    <div className="w-full border border-border rounded-lg p-3">
      <HStack className="w-full justify-between mb-2">
        <HStack spacing={2}>
          <span className="text-sm font-medium">{step.name || t`Step`}</span>
          {status && <DiffBadge status={status} />}
        </HStack>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderStagedOperationStep(
              changeOrderId,
              affectedId,
              operationId,
              step.id
            )}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove step`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperationStep(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationStepValidator}
        defaultValues={{
          id: step.id,
          changeOrderId,
          stagedOperationId: operationId,
          name: step.name,
          description: (step.description as string | undefined) ?? "",
          type: step.type ?? "Task",
          required: step.required ?? false,
          sortOrder: step.sortOrder ?? 0,
          unitOfMeasureCode: step.unitOfMeasureCode ?? "",
          minValue: step.minValue ?? undefined,
          maxValue: step.maxValue ?? undefined
        }}
        className="w-full"
      >
        <Hidden name="id" value={step.id} />
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <StepFields isDisabled={isDisabled} />
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

function StepForm({
  changeOrderId,
  affectedId,
  operationId,
  nextOrder
}: {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  nextOrder: number;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  return (
    <div className="w-full border border-dashed border-border rounded-lg p-3">
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperationStep(
          changeOrderId,
          affectedId,
          operationId
        )}
        validator={changeOrderStagedOperationStepValidator}
        defaultValues={{
          changeOrderId,
          stagedOperationId: operationId,
          name: "",
          description: "",
          type: "Task",
          required: false,
          sortOrder: nextOrder,
          unitOfMeasureCode: ""
        }}
        className="w-full"
        resetAfterSubmit
      >
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="stagedOperationId" value={operationId} />
        <StepFields isDisabled={false} />
        <HStack className="w-full justify-end mt-2">
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add Step</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>
    </div>
  );
}
