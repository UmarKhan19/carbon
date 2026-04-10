import {
  Count,
  cn,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Skeleton,
  VStack
} from "@carbon/react";
import { useMemo, useState } from "react";
import { LuChevronRight, LuCirclePlus, LuSearch, LuTag } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import Hyperlink from "~/components/Hyperlink";
import { LevelLine } from "~/components/TreeView/TreeView";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListStatusType } from "../types";
import PriceListStatus from "./PriceListStatus";

type PriceListItemRow = {
  id: string;
  itemId: string | null;
  itemPostingGroupId: string | null;
  unitPrice: number;
  item?: { id: string; readableId: string; name: string } | null;
  itemPostingGroup?: { id: string; name: string } | null;
};

type PriceListAssignmentRow = {
  id: string;
  customerId: string | null;
  customerTypeId: string | null;
  customer?: { id: string; name: string } | null;
  customerType?: { id: string; name: string } | null;
};

type PriceListVersionRow = {
  id: string;
  version: number;
  status: string;
};

type SalesOrderLineRef = {
  salesOrderId: string;
  salesOrder: { id: string; salesOrderId: string } | null;
};

type DefaultEntity = { id: string; name: string };

export type PriceListExplorerProps = {
  items: PriceListItemRow[];
  assignments: PriceListAssignmentRow[];
  versions: PriceListVersionRow[];
  salesOrders: SalesOrderLineRef[];
  defaultCustomers: DefaultEntity[];
  priceListId: string;
};

/** Remove duplicate entries by ID (e.g. same sales order appearing on multiple lines) */
function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Sections with fewer items than this auto-expand on load */
const MAX_AUTO_EXPAND = 20;

/** Collapsible section in the explorer sidebar with optional "add" button */
function Section({
  title,
  count,
  onAdd,
  children
}: {
  title: string;
  count: number;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(
    count > 0 && count <= MAX_AUTO_EXPAND
  );

  return (
    <>
      <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full hover:bg-accent">
        <button
          type="button"
          className="flex flex-grow cursor-pointer items-center overflow-hidden font-medium"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((prev) => !prev);
          }}
        >
          <div className="h-8 w-4 flex items-center justify-center">
            <LuChevronRight
              className={cn("size-4", isExpanded && "rotate-90")}
            />
          </div>
          <div className="flex flex-grow items-center justify-between gap-2">
            <span>{title}</span>
            {count > 0 && <Count count={count} />}
          </div>
        </button>
        {onAdd && (
          <IconButton
            aria-label={`Add ${title}`}
            size="sm"
            variant="ghost"
            icon={<LuCirclePlus />}
            className="ml-auto"
            onClick={onAdd}
          />
        )}
      </div>
      {isExpanded && <div className="flex flex-col w-full">{children}</div>}
    </>
  );
}

function ExplorerRow({
  to,
  label,
  icon
}: {
  to: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <Hyperlink
      to={to}
      className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-accent w-full font-medium whitespace-nowrap"
    >
      <LevelLine isSelected={false} className="mr-2" />
      {icon && (
        <span className="text-muted-foreground flex-shrink-0 mr-2">{icon}</span>
      )}
      <span className="truncate">{label}</span>
    </Hyperlink>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
      <LevelLine isSelected={false} />
      <span className="text-xs text-muted-foreground">No {label} found</span>
    </div>
  );
}

export function PriceListExplorer({
  items,
  assignments,
  versions,
  salesOrders,
  defaultCustomers,
  priceListId
}: PriceListExplorerProps) {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [filterText, setFilterText] = useState("");
  const q = filterText.toLowerCase();

  const permissionModule = "sales";
  const canCreate = permissions.can("create", permissionModule);

  const filteredSpecificItems = useMemo(
    () =>
      items.filter((item) => {
        if (!item.itemId || !item.item) return false;
        if (!q) return true;
        return (
          item.item.readableId.toLowerCase().includes(q) ||
          item.item.name.toLowerCase().includes(q)
        );
      }),
    [items, q]
  );

  const filteredItemGroups = useMemo(
    () =>
      items.filter((item) => {
        if (!item.itemPostingGroupId || !item.itemPostingGroup) return false;
        if (!q) return true;
        return item.itemPostingGroup.name.toLowerCase().includes(q);
      }),
    [items, q]
  );

  // Merge assigned customers with customers using this as their default price list
  const customers = useMemo(() => {
    const result: { id: string; name: string; link: string }[] = [];
    const seenIds = new Set<string>();

    for (const a of assignments) {
      if (a.customerId && a.customer && !seenIds.has(a.customerId)) {
        seenIds.add(a.customerId);
        result.push({
          id: a.customerId,
          name: a.customer.name,
          link: path.to.customer(a.customerId)
        });
      }
    }

    for (const c of defaultCustomers) {
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        result.push({
          id: c.id,
          name: c.name,
          link: path.to.customer(c.id)
        });
      }
    }

    return result.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [assignments, defaultCustomers, q]);

  const customerTypes = useMemo(() => {
    const result: { id: string; name: string; link: string }[] = [];
    const seenIds = new Set<string>();

    for (const a of assignments) {
      if (
        a.customerTypeId &&
        a.customerType &&
        !seenIds.has(a.customerTypeId)
      ) {
        seenIds.add(a.customerTypeId);
        result.push({
          id: a.customerTypeId,
          name: a.customerType.name,
          link: `${path.to.customers}?filter=customerTypeId:eq:${a.customerTypeId}`
        });
      }
    }

    return result.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [assignments, q]);

  const uniqueSalesOrders = useMemo(
    () =>
      deduplicateById(
        salesOrders
          .filter((r) => r.salesOrder != null)
          .map((r) => ({
            id: r.salesOrder!.id,
            readableId: r.salesOrder!.salesOrderId
          }))
      ).filter((o) => !q || o.readableId.toLowerCase().includes(q)),
    [salesOrders, q]
  );

  const filteredVersions = useMemo(
    () =>
      versions.filter((v) => {
        if (!q) return true;
        return (
          `v${v.version}`.toLowerCase().includes(q) ||
          v.status.toLowerCase().includes(q)
        );
      }),
    [versions, q]
  );

  return (
    <div className="flex flex-col h-full">
      <HStack className="w-full justify-between flex-shrink-0 p-2 pb-0">
        <InputGroup size="sm" className="flex flex-grow">
          <InputLeftElement>
            <LuSearch className="h-4 w-4" />
          </InputLeftElement>
          <Input
            placeholder="Search..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </InputGroup>
      </HStack>
      <div className="flex-1 overflow-y-auto">
        <VStack className="w-full p-2" spacing={0}>
          <Section title="Versions" count={filteredVersions.length}>
            {filteredVersions.length === 0 ? (
              <EmptyRow label="versions" />
            ) : (
              filteredVersions.map((version) => (
                <Link
                  key={version.id}
                  to={path.to.priceListDetails(version.id)}
                  className={cn(
                    "flex h-8 items-center overflow-hidden rounded-sm px-1 gap-2 text-sm hover:bg-accent w-full whitespace-nowrap",
                    version.id === priceListId && "font-semibold"
                  )}
                >
                  <LevelLine
                    isSelected={version.id === priceListId}
                    className="mr-2"
                  />
                  <LuTag className="size-4 text-muted-foreground flex-shrink-0 mr-2" />
                  <span className="truncate flex-grow">v{version.version}</span>
                  <span className="flex-shrink-0">
                    <PriceListStatus
                      status={version.status as PriceListStatusType}
                    />
                  </span>
                </Link>
              ))
            )}
          </Section>

          <Section
            title="Items"
            count={filteredSpecificItems.length}
            onAdd={
              canCreate
                ? () => navigate(`${path.to.priceListItems(priceListId)}/new`)
                : undefined
            }
          >
            {filteredSpecificItems.length === 0 ? (
              <EmptyRow label="items" />
            ) : (
              filteredSpecificItems.map((item) => (
                <ExplorerRow
                  key={item.id}
                  to={path.to.part(item.itemId!)}
                  label={`${item.item!.readableId} — ${item.item!.name}`}
                  icon={<LuTag className="size-4" />}
                />
              ))
            )}
          </Section>

          {filteredItemGroups.length > 0 && (
            <Section
              title="Item Groups"
              count={filteredItemGroups.length}
              onAdd={
                canCreate
                  ? () => navigate(`${path.to.priceListItems(priceListId)}/new`)
                  : undefined
              }
            >
              {filteredItemGroups.map((item) => (
                <ExplorerRow
                  key={item.id}
                  to={`${path.to.parts}?filter=itemPostingGroupId:eq:${item.itemPostingGroupId}`}
                  label={item.itemPostingGroup!.name}
                  icon={<LuTag className="size-4" />}
                />
              ))}
            </Section>
          )}

          <Section title="Customers" count={customers.length}>
            {customers.length === 0 ? (
              <EmptyRow label="customers" />
            ) : (
              customers.map((entity) => (
                <ExplorerRow
                  key={entity.id}
                  to={entity.link}
                  label={entity.name}
                  icon={<LuTag className="size-4" />}
                />
              ))
            )}
          </Section>

          {customerTypes.length > 0 && (
            <Section title="Customer Types" count={customerTypes.length}>
              {customerTypes.map((entity) => (
                <ExplorerRow
                  key={entity.id}
                  to={entity.link}
                  label={entity.name}
                  icon={<LuTag className="size-4" />}
                />
              ))}
            </Section>
          )}

          {uniqueSalesOrders.length > 0 && (
            <Section title="Sales Orders" count={uniqueSalesOrders.length}>
              {uniqueSalesOrders.map((order) => (
                <ExplorerRow
                  key={order.id}
                  to={path.to.salesOrder(order.id)}
                  label={order.readableId}
                  icon={<LuTag className="size-4" />}
                />
              ))}
            </Section>
          )}
        </VStack>
      </div>
    </div>
  );
}

export const PriceListExplorerSkeleton = () => (
  <div className="p-2 space-y-2">
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-6 w-3/4" />
    <Skeleton className="h-6 w-3/4" />
    <Skeleton className="h-6 w-1/2" />
  </div>
);
