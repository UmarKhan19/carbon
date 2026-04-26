import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendarClock,
  LuCheck,
  LuFile,
  LuHash,
  LuNetwork,
  LuQrCode,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import type { TrackedEntity } from "~/modules/inventory";
import { trackedEntityStatus } from "~/modules/inventory";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { Item } from "~/stores/items";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import TrackedEntityStatus from "./TrackedEntityStatus";

type TrackedEntitiesTableProps = {
  data: TrackedEntity[];
  count: number;
  nearExpiryWarningDays: number | null;
};

const TrackedEntitiesTable = memo(
  ({ data, count, nearExpiryWarningDays }: TrackedEntitiesTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const numberFormatter = useNumberFormatter();
    const [items] = useItems();

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(
      () => [
        {
          accessorKey: "sourceDocumentId",
          header: t`Entity`,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.traceabilityGraph}?trackedEntityId=${row.original.id}`}
            >
              <div className="flex flex-col items-start gap-0">
                <span>{row.original.sourceDocumentReadableId}</span>
                <span className="text-xs text-muted-foreground">
                  {row.original.id}
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />,

            filter: {
              type: "static",
              options: items.map((i) => ({
                label: i.readableIdWithRevision,
                value: i.id
              }))
            }
          }
        },
        {
          accessorKey: "readableId",
          header: t`Serial/Batch #`,
          cell: ({ row }) =>
            row.original.readableId ? (
              <Badge variant="secondary" className="items-center gap-1">
                <LuQrCode />
                {row.original.readableId}
              </Badge>
            ) : null,
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) => (
            <span>{numberFormatter.format(row.original.quantity)}</span>
          ),
          meta: {
            icon: <LuHash />,
            renderTotal: true
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <TrackedEntityStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCheck />,
            filter: {
              type: "static",
              options: trackedEntityStatus
                .filter((v) => v !== "Reserved")
                .map((v) => ({
                  label: <TrackedEntityStatus status={v} />,
                  value: v
                }))
            }
          }
        },
        {
          id: "expirationDate",
          accessorKey: "expirationDate",
          header: t`Expiry`,
          cell: ({ row }) => {
            const expiry = row.original.expirationDate ?? undefined;
            if (!expiry) return null;
            const formatted = formatDate(expiry);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const expiryDate = new Date(expiry);
            const daysLeft = Math.floor(
              (expiryDate.getTime() - today.getTime()) / 86_400_000
            );
            if (daysLeft < 0) {
              return (
                <Badge variant="destructive" className="gap-1">
                  <LuTriangleAlert className="size-3" />
                  {t`Expired`} · {formatted}
                </Badge>
              );
            }
            if (
              nearExpiryWarningDays !== null &&
              daysLeft <= nearExpiryWarningDays
            ) {
              return (
                <Badge variant="yellow" className="gap-1">
                  <LuTriangleAlert className="size-3" />
                  {formatted}
                </Badge>
              );
            }
            return (
              <span className="text-sm text-muted-foreground">{formatted}</span>
            );
          },
          meta: {
            icon: <LuCalendarClock />
          }
        },
        {
          accessorKey: "sourceDocument",
          header: t`Source Document`,
          cell: ({ row }) => (
            <SourceDocumentLink data={row.original} items={items} />
          ),
          meta: {
            icon: <LuFile />
          }
        }
      ],
      [numberFormatter, items, t, nearExpiryWarningDays]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.traceabilityGraph}?trackedEntityId=${row.id}`
                );
              }}
            >
              <MenuIcon icon={<LuNetwork />} />
              <Trans>View Traceability Graph</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, permissions]
    );

    return (
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        renderContextMenu={renderContextMenu}
        title={t`Tracked Entities`}
      />
    );
  }
);

function SourceDocumentLink({
  data,
  items
}: {
  data: TrackedEntity;
  items: Item[];
}) {
  switch (data.sourceDocument) {
    case "Item":
      const item = items.find((item) => item.id === data.sourceDocumentId);
      if (!item) return <Enumerable value={data.sourceDocument} />;
      return (
        // @ts-ignore
        <Hyperlink to={getLinkToItemDetails(item.type, item.id)}>
          <Enumerable value={data.sourceDocument} />
        </Hyperlink>
      );
    default:
      return <Enumerable value={data.sourceDocument} />;
  }
}

TrackedEntitiesTable.displayName = "TrackedEntitiesTable";
export default TrackedEntitiesTable;
