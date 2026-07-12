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
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Hidden,
  Input,
  Number,
  Process,
  Select,
  StandardFactor,
  Submit,
  WorkCenter
} from "~/components/Form";
import { methodOperationOrders, operationTypes } from "~/modules/shared";
import { path } from "~/utils/path";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { changeOrderStagedOperationValidator } from "../../changeOrder.models";
import type {
  ChangeOrderBopChildrenData,
  ChangeOrderBopChildrenDiff
} from "./ChangeOrderBopChildren";
import ChangeOrderBopChildren from "./ChangeOrderBopChildren";

type StagedOperation =
  Database["public"]["Tables"]["changeOrderStagedOperation"]["Row"];

// The operation diff carries an optional child-level diff (steps/parameters/
// tools) — see OperationDiffEntry in changeOrder.diff.ts. Typed structurally
// here so the editor stays decoupled from the diff module.
type OperationDiff = MethodDiffEntry<Record<string, unknown>> & {
  children?: ChangeOrderBopChildrenDiff;
};

const EMPTY_CHILDREN: ChangeOrderBopChildrenData = {
  steps: [],
  parameters: [],
  tools: []
};

type ChangeOrderBopEditorProps = {
  changeOrderId: string;
  affectedId: string;
  operations: StagedOperation[];
  diff?: OperationDiff[];
  // Staged operation children keyed by staged operation id. Optional — when the
  // loader hasn't threaded children yet the child editors render empty and the
  // add-forms still POST to the child routes.
  children?: Record<string, ChangeOrderBopChildrenData>;
  isDisabled: boolean;
};

function buildDiffMap(diff?: OperationDiff[]): Map<string, OperationDiff> {
  const map = new Map<string, OperationDiff>();
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

const operationTypeOptions = operationTypes.map((o) => ({
  value: o,
  label: o
}));
const operationOrderOptions = methodOperationOrders.map((o) => ({
  value: o,
  label: o
}));

export default function ChangeOrderBopEditor({
  changeOrderId,
  affectedId,
  operations,
  diff,
  children,
  isDisabled
}: ChangeOrderBopEditorProps) {
  const { t } = useLingui();
  const diffMap = buildDiffMap(diff);

  const stagedIds = new Set(operations.map((o) => o.id));
  const removedEntries = (diff ?? []).filter((entry) => {
    if (entry.status !== "removed") return false;
    const beforeId = (entry.before as { id?: string } | null)?.id;
    return beforeId ? !stagedIds.has(beforeId) : true;
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Bill of Process</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={3}>
          {operations.length === 0 && removedEntries.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              <Trans>No operations staged for this item.</Trans>
            </p>
          )}

          {operations
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((operation) => (
              <BopOperation
                key={operation.id}
                changeOrderId={changeOrderId}
                affectedId={affectedId}
                operation={operation}
                status={diffMap.get(operation.id)?.status}
                children={children?.[operation.id] ?? EMPTY_CHILDREN}
                childDiff={diffMap.get(operation.id)?.children}
                isDisabled={isDisabled}
              />
            ))}

          {removedEntries.map((entry, index) => {
            const before = entry.before as {
              id?: string;
              description?: string;
            } | null;
            return (
              <HStack
                key={before?.id ?? `removed-${index}`}
                className="w-full justify-between border border-border rounded-lg p-3 opacity-60"
              >
                <span className="text-sm font-medium line-through">
                  {before?.description || t`Operation`}
                </span>
                <DiffBadge status="removed" />
              </HStack>
            );
          })}

          {!isDisabled && (
            <NewBopOperation
              changeOrderId={changeOrderId}
              affectedId={affectedId}
              nextOrder={
                operations.reduce((max, o) => Math.max(max, o.order), 0) + 1
              }
            />
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function BopOperation({
  changeOrderId,
  affectedId,
  operation,
  status,
  children,
  childDiff,
  isDisabled
}: {
  changeOrderId: string;
  affectedId: string;
  operation: StagedOperation;
  status?: MethodDiffEntry<unknown>["status"];
  children: ChangeOrderBopChildrenData;
  childDiff?: ChangeOrderBopChildrenDiff;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  return (
    <div
      className={cn(
        "w-full border border-border rounded-lg p-4",
        status === "added" && "border-l-2 border-l-emerald-500",
        status === "modified" && "border-l-2 border-l-amber-500"
      )}
    >
      <HStack className="w-full justify-between mb-3">
        <HStack spacing={2}>
          <span className="text-sm font-medium">
            {operation.description || t`Operation`}
          </span>
          {status && <DiffBadge status={status} />}
        </HStack>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderStagedOperation(
              changeOrderId,
              affectedId,
              operation.id
            )}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove operation`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>

      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperation(changeOrderId, affectedId)}
        validator={changeOrderStagedOperationValidator}
        defaultValues={{
          id: operation.id,
          changeOrderId,
          affectedItemId: affectedId,
          order: operation.order,
          operationOrder: operation.operationOrder,
          operationType: operation.operationType ?? "Inside",
          processId: operation.processId ?? "",
          workCenterId: operation.workCenterId ?? "",
          description: operation.description ?? "",
          setupTime: operation.setupTime,
          setupUnit: operation.setupUnit,
          laborTime: operation.laborTime,
          laborUnit: operation.laborUnit,
          machineTime: operation.machineTime,
          machineUnit: operation.machineUnit,
          sourceOperationId: operation.sourceOperationId ?? ""
        }}
        className="w-full"
      >
        <Hidden name="id" value={operation.id} />
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="affectedItemId" value={affectedId} />
        <Hidden name="order" value={String(operation.order)} />
        {operation.sourceOperationId && (
          <Hidden
            name="sourceOperationId"
            value={operation.sourceOperationId}
          />
        )}
        <OperationFields isDisabled={isDisabled} />
        <HStack className="w-full justify-end mt-3">
          <Submit
            isDisabled={isDisabled || fetcher.state !== "idle"}
            isLoading={fetcher.state === "submitting"}
          >
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>

      <div className="mt-4 border-t border-border pt-3">
        <ChangeOrderBopChildren
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operation.id}
          children={children}
          diff={childDiff}
          isDisabled={isDisabled}
        />
      </div>
    </div>
  );
}

function OperationFields({ isDisabled }: { isDisabled: boolean }) {
  const { t } = useLingui();
  return (
    <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
      <Select
        name="operationType"
        label={t`Operation Type`}
        options={operationTypeOptions}
        isReadOnly={isDisabled}
      />
      <Process name="processId" label={t`Process`} isOptional />
      <WorkCenter name="workCenterId" label={t`Work Center`} isOptional />
      <Input
        name="description"
        label={t`Description`}
        className="lg:col-span-3"
        isDisabled={isDisabled}
      />
      <Number name="setupTime" label={t`Setup Time`} minValue={0} />
      <StandardFactor name="setupUnit" label={t`Setup Unit`} />
      <div />
      <Number name="laborTime" label={t`Labor Time`} minValue={0} />
      <StandardFactor name="laborUnit" label={t`Labor Unit`} />
      <div />
      <Number name="machineTime" label={t`Machine Time`} minValue={0} />
      <StandardFactor name="machineUnit" label={t`Machine Unit`} />
      <Select
        name="operationOrder"
        label={t`Operation Order`}
        options={operationOrderOptions}
        isReadOnly={isDisabled}
      />
    </div>
  );
}

function NewBopOperation({
  changeOrderId,
  affectedId,
  nextOrder
}: {
  changeOrderId: string;
  affectedId: string;
  nextOrder: number;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <div className="w-full border border-dashed border-border rounded-lg p-4">
      <ValidatedForm
        fetcher={fetcher}
        method="post"
        action={path.to.changeOrderStagedOperation(changeOrderId, affectedId)}
        validator={changeOrderStagedOperationValidator}
        defaultValues={{
          changeOrderId,
          affectedItemId: affectedId,
          order: nextOrder,
          operationOrder: "After Previous",
          operationType: "Inside",
          processId: "",
          workCenterId: "",
          description: "",
          setupTime: 0,
          setupUnit: "Total Minutes",
          laborTime: 0,
          laborUnit: "Minutes/Piece",
          machineTime: 0,
          machineUnit: "Minutes/Piece"
        }}
        className="w-full"
        resetAfterSubmit
      >
        <Hidden name="changeOrderId" value={changeOrderId} />
        <Hidden name="affectedItemId" value={affectedId} />
        <Hidden name="order" value={String(nextOrder)} />
        <OperationFields isDisabled={false} />
        <HStack className="w-full justify-end mt-3">
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add Operation</Trans>
          </Submit>
        </HStack>
      </ValidatedForm>
    </div>
  );
}
