import {
  Checkbox,
  Combobox,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  Spinner
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuLayers,
  LuMapPin,
  LuPencil,
  LuPlus,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useStorageTypes } from "~/components/Form/StorageTypes";
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
  storageTypeIds: string[] | null;
};

type StorageUnitsTableProps = {
  data: StorageUnit[];
  count: number;
  locations: { id: string; name: string }[];
  locationId: string;
  storageTypes: { id: string; name: string }[];
  parentIdsWithChildren: string[];
  initialExpanded: string[];
};

const StorageUnitsTable = memo(
  ({
    data,
    count,
    locations: serverLocations,
    locationId,
    storageTypes: serverStorageTypes,
    parentIdsWithChildren,
    initialExpanded
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

    // Storage types come from the server loader so the Storage Types column
    // resolves names on first paint. Fall back to the client-side
    // useStorageTypes() hook only if the server payload is somehow missing.
    const clientStorageTypes = useStorageTypes();
    const storageTypes = useMemo(() => {
      if (serverStorageTypes && serverStorageTypes.length > 0) {
        return serverStorageTypes.map((st) => ({
          value: st.id,
          label: st.name
        }));
      }
      return clientStorageTypes;
    }, [serverStorageTypes, clientStorageTypes]);

    const hasChildrenSet = useMemo(
      () => new Set(parentIdsWithChildren),
      [parentIdsWithChildren]
    );

    // Partition `data` into children-by-parentId. In root-mode (no search)
    // every row is a root and this map is empty. In search-mode it contains
    // the ancestor chains for each match so the tree can render without
    // additional fetches.
    const initialChildrenCache = useMemo(() => {
      const map: Record<string, StorageUnit[]> = {};
      for (const row of data) {
        if (row.parentId) {
          (map[row.parentId] ??= []).push(row);
        }
      }
      return map;
    }, [data]);

    const [childrenCache, setChildrenCache] =
      useState<Record<string, StorageUnit[]>>(initialChildrenCache);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
      () => new Set(initialExpanded)
    );
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

    // Reset state when the loader payload changes (location switch, search,
    // pagination) so stale expand state doesn't leak across navigations.
    useEffect(() => {
      setChildrenCache(initialChildrenCache);
      setExpandedIds(new Set(initialExpanded));
      setLoadingIds(new Set());
    }, [initialChildrenCache, initialExpanded]);

    const toggleExpand = useCallback(
      async (id: string) => {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });

        // Only fetch if not collapsing and we don't already have children.
        const isExpanding = !expandedIds.has(id);
        if (!isExpanding) return;
        if (childrenCache[id]) return;

        setLoadingIds((prev) => new Set(prev).add(id));
        try {
          const res = await fetch(path.to.api.storageUnitChildren(id));
          const body = (await res.json()) as { data: StorageUnit[] };
          setChildrenCache((prev) => ({ ...prev, [id]: body.data ?? [] }));
        } finally {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      },
      [expandedIds, childrenCache]
    );

    // Build the displayed flat-row list by walking roots and recursing into
    // expanded subtrees. Roots = depth-1 rows in `data` (true for both
    // root-mode and search-mode payloads).
    const displayRows = useMemo(() => {
      const out: StorageUnit[] = [];
      const roots = data.filter((r) => (r.depth ?? 1) === 1);

      const walk = (node: StorageUnit) => {
        out.push(node);
        if (!expandedIds.has(node.id)) return;
        const kids = childrenCache[node.id];
        if (!kids) return;
        for (const kid of kids) walk(kid);
      };

      for (const root of roots) walk(root);
      return out;
    }, [data, expandedIds, childrenCache]);

    const columns = useMemo<ColumnDef<StorageUnit>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => {
            const depth = Math.max(0, (row.original.depth ?? 1) - 1);
            const isExpanded = expandedIds.has(row.original.id);
            const isLoading = loadingIds.has(row.original.id);
            const hasChildren = hasChildrenSet.has(row.original.id);

            return (
              <div className="flex items-stretch self-stretch gap-1">
                <div className="size-7 shrink-0 flex items-center justify-center self-center">
                  {hasChildren ? (
                    <IconButton
                      aria-label={
                        isExpanded ? t`Collapse subtree` : t`Expand subtree`
                      }
                      icon={
                        isLoading ? (
                          <Spinner className="size-3" />
                        ) : isExpanded ? (
                          <LuChevronDown />
                        ) : (
                          <LuChevronRight />
                        )
                      }
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleExpand(row.original.id);
                      }}
                    />
                  ) : null}
                </div>
                {Array.from({ length: depth }).map((_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="w-5 shrink-0 border-l border-border -my-2"
                  />
                ))}
                <div className="flex items-center py-1">
                  <Hyperlink
                    to={`${path.to.storageUnit(row.original.id)}?${params}`}
                  >
                    <span
                      className={
                        depth === 0 ? "font-medium" : "text-foreground/90"
                      }
                    >
                      {row.original.name}
                    </span>
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
          accessorKey: "storageTypeIds",
          header: t`Storage Types`,
          cell: ({ row }) => {
            if (!row.original.storageTypeIds?.length) return null;
            return (
              <HStack spacing={1}>
                {row.original.storageTypeIds.map((id) => {
                  const label =
                    storageTypes?.find((st) => st.value === id)?.label ?? id;
                  return <Enumerable key={id} value={label} />;
                })}
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: storageTypes?.map((st) => ({
                value: st.value,
                label: <Enumerable value={st.label} />
              })),
              isArray: true
            },
            pluralHeader: t`Storage Types`,
            icon: <LuLayers />
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
    }, [
      locations,
      params,
      storageTypes,
      t,
      expandedIds,
      loadingIds,
      hasChildrenSet,
      toggleExpand
    ]);

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
        data={displayRows}
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
