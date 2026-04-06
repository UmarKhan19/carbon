import {
  Count,
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  ScrollArea,
  Skeleton
} from "@carbon/react";
import { useMemo, useState } from "react";
import {
  LuBox,
  LuChevronRight,
  LuCirclePlus,
  LuContainer,
  LuHistory,
  LuLayoutList,
  LuSearch,
  LuShapes,
  LuSquareUser,
  LuStar
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import Hyperlink from "~/components/Hyperlink";
import { LevelLine } from "~/components/TreeView/TreeView";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  supplierId: string | null;
  supplierTypeId: string | null;
  customer?: { id: string; name: string } | null;
  customerType?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  supplierType?: { id: string; name: string } | null;
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

type PurchaseOrderLineRef = {
  purchaseOrderId: string;
  purchaseOrder: { id: string; purchaseOrderId: string } | null;
};

type DefaultEntity = { id: string; name: string };

export type PriceListExplorerProps = {
  items: PriceListItemRow[];
  assignments: PriceListAssignmentRow[];
  versions: PriceListVersionRow[];
  salesOrders: SalesOrderLineRef[];
  purchaseOrders: PurchaseOrderLineRef[];
  defaultCustomers: DefaultEntity[];
  defaultSuppliers: DefaultEntity[];
  priceListId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Section (collapsible header + children)
// ---------------------------------------------------------------------------

const MAX_AUTO_EXPAND = 20;

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
    <div className="flex flex-col w-full">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full hover:bg-accent"
      >
        <div className="h-8 w-4 flex items-center justify-center flex-shrink-0">
          <LuChevronRight
            className={cn(
              "size-4 transition-transform",
              isExpanded && "rotate-90"
            )}
          />
        </div>
        <span className="font-medium flex-grow text-left truncate">
          {title}
        </span>
        {count > 0 && <Count count={count} />}
        {onAdd && (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Add ${title}`}
            className="ml-1 rounded-sm p-0.5 hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onAdd();
              }
            }}
          >
            <LuCirclePlus className="size-4" />
          </div>
        )}
      </button>
      {isExpanded && (
        <div className="flex flex-col w-full px-2">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — Hyperlink with "Open" button on hover
// ---------------------------------------------------------------------------

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
      <LevelLine isSelected={false} />
      {icon && (
        <span className="text-muted-foreground flex-shrink-0">{icon}</span>
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PriceListExplorer({
  items,
  assignments,
  versions,
  salesOrders,
  purchaseOrders,
  defaultCustomers,
  defaultSuppliers,
  priceListId
}: PriceListExplorerProps) {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [filterText, setFilterText] = useState("");
  const q = filterText.toLowerCase();

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(priceListId)
  );
  const priceListType = routeData?.priceList?.type ?? "Sales";
  const isSales = priceListType === "Sales";
  const permissionModule = isSales ? "sales" : "purchasing";
  const canCreate = permissions.can("create", permissionModule);

  // ---- Items (specific items vs item groups) ----
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

  // ---- Customers (assigned + defaults, deduplicated) ----
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

  // ---- Customer Types (from assignments only) ----
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

  // ---- Suppliers (assigned + defaults, deduplicated) ----
  const suppliers = useMemo(() => {
    const result: { id: string; name: string; link: string }[] = [];
    const seenIds = new Set<string>();

    for (const a of assignments) {
      if (a.supplierId && a.supplier && !seenIds.has(a.supplierId)) {
        seenIds.add(a.supplierId);
        result.push({
          id: a.supplierId,
          name: a.supplier.name,
          link: path.to.supplier(a.supplierId)
        });
      }
    }

    for (const s of defaultSuppliers) {
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        result.push({
          id: s.id,
          name: s.name,
          link: path.to.supplier(s.id)
        });
      }
    }

    return result.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [assignments, defaultSuppliers, q]);

  // ---- Supplier Types (from assignments only) ----
  const supplierTypes = useMemo(() => {
    const result: { id: string; name: string; link: string }[] = [];
    const seenIds = new Set<string>();

    for (const a of assignments) {
      if (
        a.supplierTypeId &&
        a.supplierType &&
        !seenIds.has(a.supplierTypeId)
      ) {
        seenIds.add(a.supplierTypeId);
        result.push({
          id: a.supplierTypeId,
          name: a.supplierType.name,
          link: `${path.to.suppliers}?filter=supplierTypeId:eq:${a.supplierTypeId}`
        });
      }
    }

    return result.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [assignments, q]);

  // ---- Sales Orders (deduplicated) ----
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

  // ---- Purchase Orders (deduplicated) ----
  const uniquePurchaseOrders = useMemo(
    () =>
      deduplicateById(
        purchaseOrders
          .filter((r) => r.purchaseOrder != null)
          .map((r) => ({
            id: r.purchaseOrder!.id,
            readableId: r.purchaseOrder!.purchaseOrderId
          }))
      ).filter((o) => !q || o.readableId.toLowerCase().includes(q)),
    [purchaseOrders, q]
  );

  // ---- Versions ----
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
    <ScrollArea className="h-full">
      <div className="flex flex-col w-full py-1">
        {/* Search */}
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          <InputGroup size="sm">
            <InputLeftElement>
              <LuSearch className="size-4 text-muted-foreground" />
            </InputLeftElement>
            <Input
              placeholder="Search..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </InputGroup>
        </div>

        {/* Specific Items */}
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
                icon={<LuBox className="size-4" />}
              />
            ))
          )}
        </Section>

        {/* Item Groups */}
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
                icon={<LuShapes className="size-4" />}
              />
            ))}
          </Section>
        )}

        {/* Customers — Sales price lists */}
        {isSales && (
          <Section
            title="Customers"
            count={customers.length}
            onAdd={
              canCreate
                ? () =>
                    navigate(`${path.to.priceListAssignments(priceListId)}/new`)
                : undefined
            }
          >
            {customers.length === 0 ? (
              <EmptyRow label="customers" />
            ) : (
              customers.map((entity) => (
                <ExplorerRow
                  key={entity.id}
                  to={entity.link}
                  label={entity.name}
                  icon={<LuSquareUser className="size-4" />}
                />
              ))
            )}
          </Section>
        )}

        {/* Customer Types — Sales price lists */}
        {isSales && customerTypes.length > 0 && (
          <Section title="Customer Types" count={customerTypes.length}>
            {customerTypes.map((entity) => (
              <ExplorerRow
                key={entity.id}
                to={entity.link}
                label={entity.name}
                icon={<LuShapes className="size-4" />}
              />
            ))}
          </Section>
        )}

        {/* Suppliers — Purchase price lists */}
        {!isSales && (
          <Section
            title="Suppliers"
            count={suppliers.length}
            onAdd={
              canCreate
                ? () =>
                    navigate(`${path.to.priceListAssignments(priceListId)}/new`)
                : undefined
            }
          >
            {suppliers.length === 0 ? (
              <EmptyRow label="suppliers" />
            ) : (
              suppliers.map((entity) => (
                <ExplorerRow
                  key={entity.id}
                  to={entity.link}
                  label={entity.name}
                  icon={<LuContainer className="size-4" />}
                />
              ))
            )}
          </Section>
        )}

        {/* Supplier Types — Purchase price lists */}
        {!isSales && supplierTypes.length > 0 && (
          <Section title="Supplier Types" count={supplierTypes.length}>
            {supplierTypes.map((entity) => (
              <ExplorerRow
                key={entity.id}
                to={entity.link}
                label={entity.name}
                icon={<LuStar className="size-4" />}
              />
            ))}
          </Section>
        )}

        {/* Sales Orders */}
        {isSales && uniqueSalesOrders.length > 0 && (
          <Section title="Sales Orders" count={uniqueSalesOrders.length}>
            {uniqueSalesOrders.map((order) => (
              <ExplorerRow
                key={order.id}
                to={path.to.salesOrder(order.id)}
                label={order.readableId}
                icon={<RiProgress8Line className="size-4" />}
              />
            ))}
          </Section>
        )}

        {/* Purchase Orders */}
        {!isSales && uniquePurchaseOrders.length > 0 && (
          <Section title="Purchase Orders" count={uniquePurchaseOrders.length}>
            {uniquePurchaseOrders.map((order) => (
              <ExplorerRow
                key={order.id}
                to={path.to.purchaseOrder(order.id)}
                label={order.readableId}
                icon={<LuLayoutList className="size-4" />}
              />
            ))}
          </Section>
        )}

        {/* Versions */}
        <Section title="Versions" count={filteredVersions.length}>
          {filteredVersions.length === 0 ? (
            <EmptyRow label="versions" />
          ) : (
            filteredVersions.map((version) => (
              <Link
                key={version.id}
                to={path.to.priceListDetails(version.id)}
                className={cn(
                  "flex h-8 items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-accent w-full whitespace-nowrap",
                  version.id === priceListId && "font-semibold"
                )}
              >
                <LevelLine isSelected={version.id === priceListId} />
                <span className="text-muted-foreground flex-shrink-0">
                  <LuHistory className="size-4" />
                </span>
                <span className="truncate flex-shrink-0">
                  v{version.version}
                </span>
                <Enumerable value={version.status} className="text-xs" />
              </Link>
            ))
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export const PriceListExplorerSkeleton = () => (
  <div className="p-2 space-y-2">
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-6 w-3/4" />
    <Skeleton className="h-6 w-3/4" />
    <Skeleton className="h-6 w-1/2" />
  </div>
);
