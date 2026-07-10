import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Combobox,
  Hidden,
  Item,
  Number as NumberField,
  Select,
  Submit
} from "~/components/Form";
import { supersessionModes } from "~/modules/items";
import { path } from "~/utils/path";
import { changeOrderBomChangeAssemblyValidator } from "../../changeOrder.models";
import ItemLink from "./ItemLink";

export type BomChangeAssembly = {
  id: string;
  assemblyItemId: string;
  quantity: number;
  supersessionMode: string | null;
  assembly: {
    id: string;
    readableIdWithRevision: string | null;
    name: string | null;
  } | null;
};

const supersessionModeOptions = supersessionModes.map((m) => ({
  label: m,
  value: m
}));

export default function BomChangeAssemblyTable({
  changeOrderId,
  rowId,
  mode,
  assemblies,
  assemblyOptions,
  isDisabled
}: {
  changeOrderId: string;
  rowId: string;
  mode: "Add" | "Delete";
  assemblies: BomChangeAssembly[];
  // Delete rows only: the fixed set of assemblies that actually consume the part.
  // The picker is restricted to these (no free-text/create). Add rows omit it and
  // choose any item.
  assemblyOptions?: { value: string; label: string }[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const isDelete = mode === "Delete";

  const addFetcher = useFetcher<{ success: boolean }>();

  const alreadyTargeted = assemblies.map((a) => a.assemblyItemId);
  // On a Delete row the picker is a fixed list; drop the ones already targeted.
  // When nothing remains, there's nothing left to delete this part from.
  const availableOptions = (assemblyOptions ?? []).filter(
    (o) => !alreadyTargeted.includes(o.value)
  );
  const noMoreToDelete = isDelete && availableOptions.length === 0;

  return (
    <VStack spacing={2} className="w-full">
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Assembly</Trans>
            </Th>
            {/* Qty is meaningless on a Delete (the whole line is removed). */}
            {!isDelete && (
              <Th>
                <Trans>Qty</Trans>
              </Th>
            )}
            {isDelete && (
              <Th>
                <Trans>Supersession</Trans>
              </Th>
            )}
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {assemblies.length === 0 ? (
            <Tr>
              <Td colSpan={3}>
                <span className="text-xs text-muted-foreground italic">
                  <Trans>No assemblies targeted yet.</Trans>
                </span>
              </Td>
            </Tr>
          ) : (
            assemblies.map((assembly) => (
              <AssemblyRow
                key={assembly.id}
                changeOrderId={changeOrderId}
                rowId={rowId}
                mode={mode}
                assembly={assembly}
                isDisabled={isDisabled}
              />
            ))
          )}
        </Tbody>
      </Table>

      {!isDisabled && noMoreToDelete && (
        <span className="text-xs text-muted-foreground italic">
          <Trans>This part isn't on any other assembly to delete from.</Trans>
        </span>
      )}

      {!isDisabled && !noMoreToDelete && (
        <ValidatedForm
          fetcher={addFetcher}
          method="post"
          action={path.to.changeOrderBomChangeAssembly(changeOrderId, rowId)}
          validator={changeOrderBomChangeAssemblyValidator}
          defaultValues={{
            bomChangeId: rowId,
            assemblyItemId: "",
            quantity: 1,
            supersessionMode: undefined
          }}
          className="w-full"
          resetAfterSubmit
        >
          <Hidden name="bomChangeId" value={rowId} />
          <HStack className="w-full items-end gap-2">
            <div className="flex-grow">
              {isDelete ? (
                // Fixed list of assemblies that consume the part — no free-text
                // or create (a new item would never be a valid delete target).
                <Combobox
                  name="assemblyItemId"
                  label={t`Add assembly`}
                  options={availableOptions}
                />
              ) : (
                <Item
                  name="assemblyItemId"
                  label={t`Add assembly`}
                  type="Item"
                  blacklist={alreadyTargeted}
                />
              )}
            </div>
            {isDelete ? (
              // Delete removes the whole BOM line — qty is irrelevant, but the
              // validator requires a positive value, so send a fixed 1.
              <Hidden name="quantity" value="1" />
            ) : (
              <div className="w-24">
                <NumberField name="quantity" label={t`Qty`} minValue={0} />
              </div>
            )}
            {isDelete && (
              <div className="w-40">
                <Select
                  name="supersessionMode"
                  label={t`Supersession`}
                  options={supersessionModeOptions}
                  placeholder={t`None`}
                />
              </div>
            )}
            <Submit>
              <Trans>Add</Trans>
            </Submit>
          </HStack>
        </ValidatedForm>
      )}
    </VStack>
  );
}

function AssemblyRow({
  changeOrderId,
  rowId,
  mode,
  assembly,
  isDisabled
}: {
  changeOrderId: string;
  rowId: string;
  mode: "Add" | "Delete";
  assembly: BomChangeAssembly;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const isDelete = mode === "Delete";
  const editFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (deleteFetcher.data && !deleteFetcher.data.success) {
      toast.error(t`Failed to remove assembly`);
    }
  }, [deleteFetcher.data, t]);

  // Inline edits (qty / supersession) POST the whole assembly upsert.
  const onUpdate = (patch: {
    quantity?: number;
    supersessionMode?: string | null;
  }) => {
    if (isDisabled) return;
    const formData = new FormData();
    formData.append("id", assembly.id);
    formData.append("bomChangeId", rowId);
    formData.append("assemblyItemId", assembly.assemblyItemId);
    formData.append("quantity", String(patch.quantity ?? assembly.quantity));
    const mode =
      patch.supersessionMode !== undefined
        ? patch.supersessionMode
        : assembly.supersessionMode;
    if (isDelete && mode) formData.append("supersessionMode", mode);
    editFetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderBomChangeAssembly(changeOrderId, rowId)
    });
  };

  return (
    <Tr>
      <Td>
        <VStack spacing={0}>
          <ItemLink
            itemId={assembly.assemblyItemId}
            type={null}
            className="text-sm font-medium"
          >
            {assembly.assembly?.readableIdWithRevision ??
              assembly.assemblyItemId}
          </ItemLink>
          {assembly.assembly?.name && (
            <span className="text-xs text-muted-foreground">
              {assembly.assembly.name}
            </span>
          )}
        </VStack>
      </Td>
      {!isDelete && (
        <Td>
          <input
            type="number"
            min={0}
            defaultValue={assembly.quantity}
            disabled={isDisabled}
            className="w-20 bg-transparent border border-border rounded-md px-2 py-1 text-sm tabular-nums"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (value > 0 && value !== assembly.quantity) {
                onUpdate({ quantity: value });
              }
            }}
          />
        </Td>
      )}
      {isDelete && (
        <Td>
          <select
            defaultValue={assembly.supersessionMode ?? ""}
            disabled={isDisabled}
            className="w-36 bg-transparent border border-border rounded-md px-2 py-1 text-sm"
            onChange={(e) =>
              onUpdate({ supersessionMode: e.target.value || null })
            }
          >
            <option value="">{t`None`}</option>
            {supersessionModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Td>
      )}
      <Td>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderBomChangeAssembly(
              changeOrderId,
              assembly.id
            )}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove assembly`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </Td>
    </Tr>
  );
}
