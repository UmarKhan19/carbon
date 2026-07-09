import { HStack, IconButton, toast, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuCircleDashed, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import BomChangeAssemblyTable from "./BomChangeAssemblyTable";
import type { BomChangeRow } from "./BomChanges";

export default function BomChangeAddRow({
  changeOrderId,
  row,
  isDisabled
}: {
  changeOrderId: string;
  row: BomChangeRow;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (deleteFetcher.data && !deleteFetcher.data.success) {
      toast.error(t`Failed to remove row`);
    }
  }, [deleteFetcher.data, t]);

  // Add rows always resolve to a real (possibly inactive/minted) item, so the
  // label is just the item. An inactive item is a forward-referenced part that
  // has not yet been synced.
  const isForwardRef = row.item ? row.item.active === false : false;

  return (
    <VStack
      spacing={2}
      className="w-full border border-border rounded-lg p-3 bg-muted/30"
    >
      <HStack className="w-full justify-between">
        <HStack spacing={2}>
          {isForwardRef && (
            <LuCircleDashed
              className="text-muted-foreground"
              aria-label={t`Not yet synced`}
            />
          )}
          <VStack spacing={0}>
            <span className="text-sm font-medium">
              {row.item?.readableIdWithRevision ?? row.itemId}
            </span>
            {row.item?.name && (
              <span className="text-xs text-muted-foreground">
                {row.item.name}
                {isForwardRef ? ` · ${t`Not yet synced`}` : ""}
              </span>
            )}
          </VStack>
        </HStack>
        {!isDisabled && (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderBomChange(changeOrderId, row.id)}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove add row`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        )}
      </HStack>

      <BomChangeAssemblyTable
        changeOrderId={changeOrderId}
        rowId={row.id}
        mode="Add"
        assemblies={row.assemblies ?? []}
        isDisabled={isDisabled}
      />
    </VStack>
  );
}
