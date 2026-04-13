import { Badge, MenuIcon, MenuItem } from "@carbon/react";
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
  LuQrCode
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
};

const TrackedEntitiesTable = memo(
  ({ data, count }: TrackedEntitiesTableProps) => {
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
          // @ts-ignore - column added in shelf-life migration, types not yet regenerated
          accessorKey: "expirationDate",
          header: "Expiration Date",
          cell: ({ row }) => {
            // @ts-ignore
            const expDate: string | null = row.original.expirationDate ?? null;
            if (!expDate) return null;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const exp = new Date(expDate + "T00:00:00");
            const msPerDay = 1000 * 60 * 60 * 24;
            const daysRemaining = Math.floor(
              (exp.getTime() - today.getTime()) / msPerDay
            );

            const label = new Intl.DateTimeFormat(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric"
            }).format(exp);

            if (daysRemaining < 0) {
              return (
                <Badge variant="destructive" className="items-center gap-1">
                  <LuCalendarClock />
                  {label}
                </Badge>
              );
            }
            if (daysRemaining <= 7) {
              return (
                <Badge variant="yellow" className="items-center gap-1">
                  <LuCalendarClock />
                  {label}
                </Badge>
              );
            }
            return (
              <Badge variant="secondary" className="items-center gap-1">
                <LuCalendarClock />
                {label}
              </Badge>
            );
          },
          meta: {
            icon: <LuCalendarClock />
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
      [numberFormatter, items, t]
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
