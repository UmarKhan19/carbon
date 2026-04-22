import {
  Hidden,
  Input,
  Number as NumberInput,
  Select,
  Submit,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowRightLeft,
  LuEllipsisVertical,
  LuSplit,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { z } from "zod";
import { usePermissions } from "~/hooks";
import TrackedEntityStatus from "~/modules/inventory/ui/Traceability/TrackedEntityStatus";
import type { action as assignAction } from "~/routes/x+/issue+/item+/assign-entities";
import type { action as splitAction } from "~/routes/x+/issue+/item+/split";
import type { action } from "~/routes/x+/issue+/item+/update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  assignIssueItemEntitiesValidator,
  disposition,
  itemQuantityValidator,
  splitIssueItemValidator
} from "../../quality.models";
import type { IssueAssociationNode } from "../../types";
import { DispositionStatus } from "./DispositionStatus";

type AssociatedItemsListProps = {
  associatedItems: IssueAssociationNode["children"];
};

type EntityLink = {
  id: string;
  quantity: number;
  trackedEntityId: string;
  trackedEntity: {
    id: string;
    status: string;
    quantity: number;
    attributes: Record<string, string> | null;
  } | null;
};

function getEntityLabel(link: EntityLink): string {
  const attrs = link.trackedEntity?.attributes ?? {};
  const name =
    (attrs["Serial Number"] as string | undefined) ??
    (attrs["Batch Number"] as string | undefined);
  if (name) return name;
  return link.trackedEntityId.slice(-8);
}

type SplitTarget = {
  id: string;
  itemId: string;
  maxQuantity: number;
  itemReadableId: string;
  links: EntityLink[];
};

type MoveTarget = {
  sourceRowId: string;
  links: EntityLink[];
  siblings: { id: string; disposition: string; itemReadableId: string }[];
};

export function AssociatedItemsList({
  associatedItems
}: AssociatedItemsListProps) {
  const [items] = useItems();
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();
  const splitFetcher = useFetcher<typeof splitAction>();
  const assignFetcher = useFetcher<typeof assignAction>();
  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (
      splitFetcher.data &&
      "error" in splitFetcher.data &&
      splitFetcher.data?.error
    ) {
      toast.error(splitFetcher.data.error.message);
    }
    if (splitFetcher.state === "idle" && (splitFetcher.data as any)?.success) {
      setSplitTarget(null);
    }
  }, [splitFetcher.data, splitFetcher.state]);

  useEffect(() => {
    if (
      assignFetcher.data &&
      "error" in assignFetcher.data &&
      assignFetcher.data?.error
    ) {
      toast.error(assignFetcher.data.error.message);
    }
    if (
      assignFetcher.state === "idle" &&
      (assignFetcher.data as any)?.success
    ) {
      setMoveTarget(null);
    }
  }, [assignFetcher.data, assignFetcher.state]);

  const onUpdateDisposition = useCallback(
    (nonConformanceItemId: string, dispositionValue: string | null) => {
      const formData = new FormData();
      formData.append("id", nonConformanceItemId);
      formData.append("field", "disposition");
      formData.append("value", dispositionValue ?? "");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateIssueItem
      });
    },
    [fetcher]
  );

  const onUpdateQuantity = useCallback(
    (nonConformanceItemId: string, quantityValue: number | null) => {
      const formData = new FormData();
      formData.append("id", nonConformanceItemId);
      formData.append("field", "quantity");
      formData.append("value", quantityValue?.toString() ?? "0");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateIssueItem
      });
    },
    [fetcher]
  );

  const rows = useMemo(() => {
    if (!associatedItems) return [];
    return associatedItems.map((child) => {
      const row = child as any;
      const links: EntityLink[] = Array.isArray(row.links) ? row.links : [];
      const quantity = Number(row.quantity ?? 0);
      const linkedSum = links.reduce(
        (acc, l) => acc + Number(l.quantity ?? 0),
        0
      );
      return {
        child,
        row,
        links,
        quantity,
        linkedSum,
        disposition: row.disposition as string | null | undefined,
        pending:
          !row.disposition || row.disposition === "Pending" ? true : false,
        sumMismatch: Math.abs(linkedSum - quantity) > 1e-6
      };
    });
  }, [associatedItems]);

  if (!associatedItems || associatedItems.length === 0) {
    return null;
  }

  const totalQuantity = rows.reduce((acc, r) => acc + r.quantity, 0);
  const canUpdate = permissions.can("update", "quality");
  const blockingRows = rows.filter((r) => r.pending || r.sumMismatch);

  return (
    <Card>
      <CardHeader>
        <HStack className="w-full justify-between">
          <CardTitle>
            {associatedItems.length > 1 ? t`Dispositions` : t`Disposition`}
          </CardTitle>
          <span className="text-sm text-muted-foreground tabular-nums">
            <Trans>Total</Trans>: {totalQuantity}
          </span>
        </HStack>
      </CardHeader>
      <CardContent>
        {blockingRows.length > 0 && (
          <Alert variant="warning" className="mb-4">
            <LuTriangleAlert className="size-4" />
            <AlertTitle>
              <Trans>Closure blocked</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Resolve these before completing the NCR: every row must have a
                non-Pending disposition, and its linked entity quantities must
                match the row quantity.
              </Trans>
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const item = items.find((i) => i.id === r.child.documentId);
            if (!item) return null;

            const siblings = rows
              .filter((s) => s.child.id !== r.child.id)
              .map((s) => ({
                id: s.child.id as string,
                disposition: (s.disposition ?? "Pending") as string,
                itemReadableId: item.readableIdWithRevision
              }));

            return (
              <li
                key={r.child.id}
                className="bg-muted/30 border border-border rounded-lg w-full px-6 py-4"
                data-blocked={r.pending || r.sumMismatch ? "true" : undefined}
              >
                <div className="flex items-center w-full gap-4">
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">
                        {item.readableIdWithRevision}
                      </h3>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">
                      {item.name}
                    </span>
                  </div>
                  <ValidatedForm
                    defaultValues={{
                      quantity: r.quantity
                    }}
                    validator={itemQuantityValidator}
                    className="w-24 flex-shrink-0"
                  >
                    <NumberInput
                      label={t`Quantity`}
                      name="quantity"
                      isReadOnly={!canUpdate}
                      minValue={0}
                      size="sm"
                      onBlur={(e) => {
                        const target = e.target as HTMLInputElement;
                        const numValue = parseFloat(target.value) || 0;
                        onUpdateQuantity(r.child.id, numValue);
                      }}
                    />
                  </ValidatedForm>
                  <ValidatedForm
                    defaultValues={{
                      disposition: r.disposition ?? "Pending"
                    }}
                    validator={z.object({
                      disposition: z.string()
                    })}
                    className="w-[120px] flex-shrink-0 items-center"
                  >
                    <Select
                      options={disposition.map((d) => ({
                        value: d,
                        label: <DispositionStatus disposition={d} />
                      }))}
                      isReadOnly={!canUpdate}
                      label={t`Status`}
                      name="disposition"
                      inline={(value) => {
                        return (
                          <div className="h-8 flex items-center">
                            <DispositionStatus disposition={value} />
                          </div>
                        );
                      }}
                      onChange={(value) => {
                        if (value) {
                          onUpdateDisposition(r.child.id, value.value);
                        }
                      }}
                    />
                  </ValidatedForm>
                  <div className="w-10 flex-shrink-0 flex items-end justify-end">
                    {canUpdate && r.links.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            size="md"
                            variant="secondary"
                            aria-label={t`More actions`}
                            icon={<LuEllipsisVertical />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {r.quantity > 1 && (
                            <DropdownMenuItem
                              onClick={() =>
                                setSplitTarget({
                                  id: r.child.id as string,
                                  itemId: item.id,
                                  maxQuantity: r.quantity,
                                  itemReadableId: item.readableIdWithRevision,
                                  links: r.links
                                })
                              }
                            >
                              <LuSplit className="mr-2 size-4" />
                              <Trans>Split line</Trans>
                            </DropdownMenuItem>
                          )}
                          {siblings.length > 0 && (
                            <DropdownMenuItem
                              onClick={() =>
                                setMoveTarget({
                                  sourceRowId: r.child.id as string,
                                  links: r.links,
                                  siblings
                                })
                              }
                            >
                              <LuArrowRightLeft className="mr-2 size-4" />
                              <Trans>Move entities…</Trans>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {r.links.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 pl-3 border-l border-border">
                    {r.links.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="font-mono text-xs truncate flex-1">
                          {getEntityLabel(link)}
                        </span>
                        <TrackedEntityStatus
                          status={link.trackedEntity?.status as any}
                        />
                        <span className="tabular-nums text-muted-foreground w-12 text-right">
                          {Number(link.quantity).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {r.sumMismatch && (
                  <p className="mt-2 text-xs text-warning-foreground">
                    <Trans>
                      Linked entity quantity ({r.linkedSum}) does not match row
                      quantity ({r.quantity}).
                    </Trans>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>

      {splitTarget && (
        <SplitLineModal
          target={splitTarget}
          fetcher={splitFetcher}
          onClose={() => setSplitTarget(null)}
        />
      )}

      {moveTarget && (
        <MoveEntitiesModal
          target={moveTarget}
          fetcher={assignFetcher}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </Card>
  );
}

function SplitLineModal({
  target,
  fetcher,
  onClose
}: {
  target: SplitTarget;
  fetcher: ReturnType<typeof useFetcher<typeof splitAction>>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const isSubmitting = fetcher.state !== "idle";
  const hasMultipleEntities = target.links.length > 1;

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedAssignments = target.links
    .filter((l) => selected[l.trackedEntityId])
    .map((l) => ({
      trackedEntityId: l.trackedEntityId,
      quantity: Number(l.quantity)
    }));

  const selectedSum = selectedAssignments.reduce(
    (acc, a) => acc + a.quantity,
    0
  );
  const canSubmit = hasMultipleEntities
    ? selectedAssignments.length > 0 &&
      selectedSum > 0 &&
      selectedSum < target.maxQuantity
    : true;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Split line</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Move some of the quantity into a new disposition row so MRB can
              decide each portion separately (e.g. scrap some, rework some).
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          fetcher={fetcher}
          method="post"
          action={path.to.splitIssueItem}
          validator={splitIssueItemValidator}
          defaultValues={{
            id: target.id,
            itemId: target.itemId,
            splitQuantity: hasMultipleEntities ? undefined : 1
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4 w-full">
              <Hidden name="id" />
              <Hidden name="itemId" />
              <input
                type="hidden"
                name="entityAssignments"
                value={
                  hasMultipleEntities ? JSON.stringify(selectedAssignments) : ""
                }
              />
              <Input
                name="currentQuantity"
                label={t`Current quantity`}
                isReadOnly
                value={String(target.maxQuantity)}
              />
              {hasMultipleEntities ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    <Trans>Entities to split off</Trans>
                  </label>
                  <ul className="flex flex-col gap-1 border border-border rounded-md p-2 max-h-64 overflow-y-auto">
                    {target.links.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={!!selected[link.trackedEntityId]}
                          onCheckedChange={(checked) =>
                            setSelected((prev) => ({
                              ...prev,
                              [link.trackedEntityId]: checked === true
                            }))
                          }
                        />
                        <span className="font-mono text-xs truncate flex-1">
                          {getEntityLabel(link)}
                        </span>
                        <TrackedEntityStatus
                          status={link.trackedEntity?.status as any}
                        />
                        <span className="tabular-nums text-muted-foreground w-12 text-right">
                          {Number(link.quantity).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      Selected: {selectedSum} / remaining after split:{" "}
                      {target.maxQuantity - selectedSum}
                    </Trans>
                  </p>
                </div>
              ) : (
                <NumberInput
                  name="splitQuantity"
                  label={t`Split off quantity`}
                  minValue={1}
                  maxValue={target.maxQuantity - 1}
                  helperText={t`Remaining after split stays on the original row.`}
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2}>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                isDisabled={isSubmitting || !canSubmit}
                isLoading={isSubmitting}
              >
                <Trans>Split</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function MoveEntitiesModal({
  target,
  fetcher,
  onClose
}: {
  target: MoveTarget;
  fetcher: ReturnType<typeof useFetcher<typeof assignAction>>;
  onClose: () => void;
}) {
  const isSubmitting = fetcher.state !== "idle";
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [targetItemId, setTargetItemId] = useState<string>(
    target.siblings[0]?.id ?? ""
  );

  const selectedAssignments = target.links
    .filter((l) => selected[l.trackedEntityId])
    .map((l) => ({
      trackedEntityId: l.trackedEntityId,
      quantity: Number(l.quantity)
    }));

  const canSubmit = selectedAssignments.length > 0 && targetItemId !== "";

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Move entities</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Reassign specific tracked entities from this row to another
              disposition row.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          fetcher={fetcher}
          method="post"
          action={path.to.assignIssueItemEntities}
          validator={assignIssueItemEntitiesValidator}
          defaultValues={{
            nonConformanceItemId: target.sourceRowId,
            targetItemId
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4 w-full">
              <Hidden name="nonConformanceItemId" />
              <input type="hidden" name="targetItemId" value={targetItemId} />
              <input
                type="hidden"
                name="entityAssignments"
                value={JSON.stringify(selectedAssignments)}
              />
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  <Trans>Target disposition row</Trans>
                </label>
                <select
                  className="border border-border rounded-md px-3 py-2 text-sm bg-background"
                  value={targetItemId}
                  onChange={(e) => setTargetItemId(e.target.value)}
                >
                  {target.siblings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.disposition}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  <Trans>Entities to move</Trans>
                </label>
                <ul className="flex flex-col gap-1 border border-border rounded-md p-2 max-h-64 overflow-y-auto">
                  {target.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={!!selected[link.trackedEntityId]}
                        onCheckedChange={(checked) =>
                          setSelected((prev) => ({
                            ...prev,
                            [link.trackedEntityId]: checked === true
                          }))
                        }
                      />
                      <span className="font-mono text-xs truncate flex-1">
                        {getEntityLabel(link)}
                      </span>
                      <TrackedEntityStatus
                        status={link.trackedEntity?.status as any}
                      />
                      <span className="tabular-nums text-muted-foreground w-12 text-right">
                        {Number(link.quantity).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2}>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                isDisabled={isSubmitting || !canSubmit}
                isLoading={isSubmitting}
              >
                <Trans>Move</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
