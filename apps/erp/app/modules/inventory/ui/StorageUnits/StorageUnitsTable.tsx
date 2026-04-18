import { Checkbox, Combobox, MenuIcon, MenuItem, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuMapPin,
  LuPencil,
  LuPlus,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type StorageUnit = {
  id: string;
  name: string;
  locationId: string | null;
  active: boolean;
  parentId: string | null;
  depth: number | null;
  ancestorPath: string[] | null;
};

type StorageUnitsTableProps = {
  data: StorageUnit[];
  count: number;
  locations: { id: string; name: string }[];
  locationId: string;
};

const StorageUnitsTable = memo(
  ({
    data,
    count,
    locations: serverLocations,
    locationId
  }: StorageUnitsTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();

    // Locations come from the server loader so the Location column resolves
    // names on first paint. Fall back to the client-side useLocations() hook
    // only if the server payload is somehow missing.
    const clientLocations = useLocations();
    const locations = useMemo(() => {
      if (serverLocations && serverLocations.length > 0) {
        return serverLocations.map((l) => ({ value: l.id, label: l.name }));
      }
      return clientLocations;
    }, [serverLocations, clientLocations]);

    // Subtree depth = the longest chain of descendants below a node.
    // Leaf = 0, parent-of-leaves = 1, has-grandchildren = 2, etc. We
    // compute it from the rows already in the table - every descendant's
    // ancestorPath lists each of its ancestors, so each descendant
    // contributes (descendant.depth - ancestor.depth) to that ancestor's
    // subtree depth. We keep the max.
    const subtreeDepthById = useMemo(() => {
      const ownDepth = new Map<string, number>();
      for (const row of data) ownDepth.set(row.id, row.depth ?? 1);

      const result = new Map<string, number>();
      for (const row of data) result.set(row.id, 0);

      for (const row of data) {
        const path = row.ancestorPath ?? [];
        // Strict ancestors only — drop the last element (which is self).
        for (let i = 0; i < path.length - 1; i++) {
          const ancestorId = path[i];
          const ancestorDepth = ownDepth.get(ancestorId);
          if (ancestorDepth === undefined) continue;
          const candidate = (row.depth ?? 1) - ancestorDepth;
          const current = result.get(ancestorId) ?? 0;
          if (candidate > current) result.set(ancestorId, candidate);
        }
      }
      return result;
    }, [data]);

    const columns = useMemo<ColumnDef<StorageUnit>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => {
            // depth is 1-based (roots = 1) per storageUnits_recursive view
            const depth = Math.max(0, (row.original.depth ?? 1) - 1);
            const ancestorLines = Math.max(0, depth);
            return (
              <div className="flex items-stretch self-stretch">
                {Array.from({ length: ancestorLines }).map((_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="w-5 shrink-0 border-l border-border -my-2"
                  />
                ))}

                <div className="flex items-center gap-2 py-1 pl-1">
                  <Hyperlink
                    to={`${path.to.storageUnit(row.original.id!)}?${params}`}
                  >
                    <VStack spacing={0}>
                      <span
                        className={
                          depth === 0 ? "font-medium" : "text-foreground/90"
                        }
                      >
                        {row.original.name}
                      </span>
                    </VStack>
                  </Hyperlink>
                </div>
              </div>
            );
          },
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => {
            const location = locations.find(
              (l) => l.value === row.original.locationId
            );
            return (
              <Enumerable value={location?.label ?? row.original.locationId} />
            );
          },
          meta: {
            icon: <LuMapPin />
          }
        },

        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        }
      ];
    }, [locations, params, subtreeDepthById, t]);

    const defaultColumnVisibility = {
      active: false
    };

    const defaultColumnPinning = {
      left: ["name"]
    };

    const actions = useMemo(() => {
      return (
        <div className="flex items-center gap-2">
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              // hard refresh because initialValues update has no effect otherwise
              window.location.href = getLocationPath(selected);
            }}
          />

          <New
            label={t`Storage Unit`}
            to={`${path.to.newStorageUnit}?location=${locationId}`}
          />
        </div>
      );
    }, [locationId, locations, t]);

    const renderContextMenu = useCallback(
      (row: StorageUnit) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(`${path.to.storageUnit(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Storage Unit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("create", "inventory")}
              onClick={() => {
                const newParams = new URLSearchParams(params);
                newParams.set("parentId", row.id);
                if (row.locationId) newParams.set("location", row.locationId);
                navigate(`${path.to.newStorageUnit}?${newParams.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPlus />} />
              <Trans>Add Child Storage Unit</Trans>
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "inventory")}
              destructive
              onClick={() => {
                // Navigate to the delete route so its loader runs and its
                // cascade-aware modal renders inside the Outlet. Rendering
                // ConfirmDelete inline here would bypass that flow.
                navigate(
                  `${path.to.deleteStorageUnit(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Storage Unit</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<StorageUnit>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={actions}
        renderContextMenu={renderContextMenu}
        title={t`Storage Units`}
        table="storageUnit"
        withSavedView
      />
    );
  }
);

StorageUnitsTable.displayName = "StorageUnitsTable";

export default StorageUnitsTable;

function getLocationPath(locationId: string) {
  return `${path.to.storageUnits}?location=${locationId}`;
}
