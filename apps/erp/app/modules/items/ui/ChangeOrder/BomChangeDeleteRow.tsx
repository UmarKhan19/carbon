import { HStack, IconButton, toast, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import BomChangeAssemblyTable from "./BomChangeAssemblyTable";
import type { BomChangeRow } from "./BomChanges";

export default function BomChangeDeleteRow({
  changeOrderId,
  row,
  assemblyOptions,
  isDisabled
}: {
  changeOrderId: string;
  row: BomChangeRow;
  assemblyOptions: { value: string; label: string }[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (deleteFetcher.data && !deleteFetcher.data.success) {
      toast.error(t`Failed to remove row`);
    }
  }, [deleteFetcher.data, t]);

  return (
    <VStack
      spacing={2}
      className="w-full border border-border rounded-lg p-3 bg-muted/30"
    >
      <HStack className="w-full justify-between">
        <VStack spacing={0}>
          <span className="text-sm font-medium">
            {row.item?.readableIdWithRevision ?? row.itemId}
          </span>
          {row.item?.name && (
            <span className="text-xs text-muted-foreground">
              {row.item.name}
            </span>
          )}
        </VStack>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderBomChange(changeOrderId, row.id)}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove delete row`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>

      <BomChangeAssemblyTable
        changeOrderId={changeOrderId}
        rowId={row.id}
        mode="Delete"
        assemblies={row.assemblies ?? []}
        assemblyOptions={assemblyOptions}
        isDisabled={isDisabled}
      />
    </VStack>
  );
}
