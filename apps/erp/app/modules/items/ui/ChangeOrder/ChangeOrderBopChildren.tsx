import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  HStack,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
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
  Tool,
  UnitOfMeasure
} from "~/components/Form";
import { procedureStepType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import {
  changeOrderStagedOperationParameterValidator,
  changeOrderStagedOperationStepValidator,
  changeOrderStagedOperationToolValidator
} from "../../changeOrder.models";

// -----------------------------------------------------------------------------
// Change Order — staged BOP operation children editor (Task 16).
//
// Renders steps / parameters / tools of a single staged operation with
// add / edit / delete, mirroring the live BillOfProcess child editors but
// posting to the CO staging routes. Diff status badges (added/modified/removed)
// are matched by the staged child row id via the per-operation child diff.
// -----------------------------------------------------------------------------

type StagedStep =
  Database["public"]["Tables"]["changeOrderStagedOperationStep"]["Row"];
type StagedParameter =
  Database["public"]["Tables"]["changeOrderStagedOperationParameter"]["Row"];
type StagedTool =
  Database["public"]["Tables"]["changeOrderStagedOperationTool"]["Row"];

type ChildDiff = MethodDiffEntry<Record<string, unknown>>;

export type ChangeOrderBopChildrenData = {
  steps: StagedStep[];
  parameters: StagedParameter[];
  tools: StagedTool[];
};

export type ChangeOrderBopChildrenDiff = {
  steps?: ChildDiff[];
  parameters?: ChildDiff[];
  tools?: ChildDiff[];
};

type ChangeOrderBopChildrenProps = {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  children: ChangeOrderBopChildrenData;
  diff?: ChangeOrderBopChildrenDiff;
  isDisabled: boolean;
};

const stepTypeOptions = procedureStepType.map((s) => ({ value: s, label: s }));

function buildDiffMap(diff?: ChildDiff[]): Map<string, ChildDiff> {
  const map = new Map<string, ChildDiff>();
  if (!diff) return map;
  for (const entry of diff) {
    const afterId = (entry.after as { id?: string } | null)?.id;
    if (afterId) map.set(afterId, entry);
  }
  return map;
}

function removedEntriesOf(
  diff: ChildDiff[] | undefined,
  presentIds: Set<string>
): ChildDiff[] {
  return (diff ?? []).filter((entry) => {
    if (entry.status !== "removed") return false;
    const beforeId = (entry.before as { id?: string } | null)?.id;
    return beforeId ? !presentIds.has(beforeId) : true;
  });
}

function DiffBadge({ status }: { status: ChildDiff["status"] }) {
  if (status === "added")
    return (
      <Badge variant="green">
        <Trans>Added</Trans>
      </Badge>
    );
  if (status === "modified")
    return (
      <Badge variant="yellow">
        <Trans>Modified</Trans>
      </Badge>
    );
  if (status === "removed")
    return (
      <Badge variant="red">
        <Trans>Removed</Trans>
      </Badge>
    );
  return null;
}

export default function ChangeOrderBopChildren({
  changeOrderId,
  affectedId,
  operationId,
  children,
  diff,
  isDisabled
}: ChangeOrderBopChildrenProps) {
  return (
    <Tabs defaultValue="steps" className="w-full">
      <TabsList>
        <TabsTrigger value="steps">
          <Trans>Steps</Trans>
        </TabsTrigger>
        <TabsTrigger value="parameters">
          <Trans>Parameters</Trans>
        </TabsTrigger>
        <TabsTrigger value="tools">
          <Trans>Tools</Trans>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="steps">
        <StepsPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          steps={children.steps}
          diff={diff?.steps}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="parameters">
        <ParametersPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          parameters={children.parameters}
          diff={diff?.parameters}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="tools">
        <ToolsPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          tools={children.tools}
          diff={diff?.tools}
          isDisabled={isDisabled}
        />
      </TabsContent>
    </Tabs>
  );
}

// --- Steps -------------------------------------------------------------------

function StepsPanel({
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
  const removed = removedEntriesOf(diff, presentIds);
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
          <HStack
            key={before?.id ?? `removed-step-${i}`}
            className="w-full justify-between border border-border rounded-lg p-2 opacity-60"
          >
            <span className="text-sm line-through">
              {before?.name || t`Step`}
            </span>
            <DiffBadge status="removed" />
          </HStack>
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

// --- Parameters --------------------------------------------------------------

function ParametersPanel({
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
  const removed = removedEntriesOf(diff, presentIds);

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
          <HStack
            key={before?.id ?? `removed-param-${i}`}
            className="w-full justify-between border border-border rounded-lg p-2 opacity-60"
          >
            <span className="text-sm line-through">
              {before?.key || t`Parameter`}
            </span>
            <DiffBadge status="removed" />
          </HStack>
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

// --- Tools -------------------------------------------------------------------

function ToolsPanel({
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
  const removed = removedEntriesOf(diff, presentIds);

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
          <HStack
            key={before?.id ?? `removed-tool-${i}`}
            className="w-full justify-between border border-border rounded-lg p-2 opacity-60"
          >
            <span className="text-sm line-through">
              {before?.toolId || t`Tool`}
            </span>
            <DiffBadge status="removed" />
          </HStack>
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
