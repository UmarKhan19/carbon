import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuArrowRightLeft,
  LuClipboardList,
  LuMapPin,
  LuSearch,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { Empty } from "~/components";
import { useDateFormatter } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

type MovementRow = {
  type: "Stock Transfer" | "Picking List" | "Shipment";
  documentId: string;
  ref: string;
  itemId: string;
  itemReadableId: string | null;
  itemName: string | null;
  quantity: number | null;
  unitOfMeasureCode: string | null;
  fromStorageUnitId: string | null;
  fromStorageUnitName: string | null;
  toStorageUnitId: string | null;
  toStorageUnitName: string | null;
  destinationCategories: string[] | null;
  assignee: string | null;
  status: string | null;
  locationId: string | null;
  createdAt: string | null;
};

export const handle: Handle = {
  breadcrumb: msg`Movements`,
  to: path.to.movements,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  // RPC returns the UNION of stockTransfer / pickingList / shipment lines.
  // Generated DB types may not yet know about get_inventory_movements —
  // cast around it. TODO: regenerate @carbon/database types.
  const { data, error: rpcError } = await (client as any).rpc(
    "get_inventory_movements",
    { p_company_id: companyId, p_location_id: locationId ?? null }
  );

  if (rpcError) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(rpcError, "Failed to load movements feed"))
    );
  }

  return {
    movements: (data as MovementRow[]) ?? []
  };
}

export default function MovementsRoute() {
  const { movements } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<MovementRow["type"] | "All">(
    "All"
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  // Distinct categories the loaded set contains, plus the implicit Customer
  // chip from the Shipment arm.
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const m of movements) {
      for (const c of m.destinationCategories ?? []) {
        set.add(c);
      }
    }
    return Array.from(set).sort();
  }, [movements]);

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (typeFilter !== "All" && m.type !== typeFilter) return false;
      if (
        categoryFilter !== "All" &&
        !(m.destinationCategories ?? []).includes(categoryFilter)
      )
        return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          m.itemReadableId,
          m.itemName,
          m.ref,
          m.fromStorageUnitName,
          m.toStorageUnitName
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [movements, typeFilter, categoryFilter, search]);

  return (
    <VStack spacing={4} className="p-4">
      <Card>
        <CardHeader>
          <HStack className="justify-between flex-wrap gap-2">
            <CardTitle>
              <Trans>Movements</Trans>
              <span className="ml-2 text-muted-foreground font-normal text-sm">
                {filtered.length}
                {filtered.length !== movements.length
                  ? ` / ${movements.length}`
                  : ""}
              </span>
            </CardTitle>

            <HStack spacing={2} className="flex-wrap">
              <div className="relative">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t`Search part / ref / shelf`}
                  className="pl-8 w-64"
                />
              </div>

              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as MovementRow["type"] | "All")
                }
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="All">{t`All types`}</option>
                <option value="Stock Transfer">{t`Stock Transfer`}</option>
                <option value="Picking List">{t`Picking List`}</option>
                <option value="Shipment">{t`Shipment`}</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="All">{t`All destinations`}</option>
                <option value="Customer">{t`Customer`}</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </HStack>
          </HStack>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <Empty className="py-10">
              <span className="text-xs text-muted-foreground">
                {t`No active movements right now.`}
              </span>
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">
                    <Trans>Type</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Reference</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Item</Trans>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <Trans>Qty</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>From</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>To</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Categories</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Status</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Created</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={`${m.type}:${m.documentId}:${m.itemId}:${m.fromStorageUnitId ?? "-"}`}
                    className="border-t hover:bg-muted/20"
                  >
                    <td className="px-4 py-2">
                      <TypeBadge type={m.type} />
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to={referenceLink(m)}
                        className="text-primary hover:underline"
                      >
                        {m.ref}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{m.itemReadableId}</span>
                        {m.itemName && (
                          <span className="text-xs text-muted-foreground">
                            {m.itemName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.quantity} {m.unitOfMeasureCode}
                    </td>
                    <td className="px-4 py-2">
                      {m.fromStorageUnitName ? (
                        <span className="flex items-center gap-1 text-xs">
                          <LuWarehouse className="h-3 w-3" />
                          {m.fromStorageUnitName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {m.toStorageUnitName ? (
                        <span className="flex items-center gap-1 text-xs">
                          <LuMapPin className="h-3 w-3" />
                          {m.toStorageUnitName}
                        </span>
                      ) : m.type === "Shipment" ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(m.destinationCategories ?? []).map((c) => (
                          <Badge key={c} variant="outline" className="text-xs">
                            {c}
                          </Badge>
                        ))}
                        {(m.destinationCategories ?? []).length === 0 && (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {m.status}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {m.createdAt ? formatDate(m.createdAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}

function TypeBadge({ type }: { type: MovementRow["type"] }) {
  const Icon =
    type === "Stock Transfer"
      ? LuArrowRightLeft
      : type === "Picking List"
        ? LuClipboardList
        : LuTruck;
  return (
    <Badge variant="outline" className="flex items-center gap-1 w-fit">
      <Icon className="h-3 w-3" />
      {type}
    </Badge>
  );
}

function referenceLink(m: MovementRow): string {
  switch (m.type) {
    case "Stock Transfer":
      return path.to.stockTransfer(m.documentId);
    case "Picking List":
      return path.to.pickingList(m.documentId);
    case "Shipment":
      return path.to.shipment(m.documentId);
    default:
      return "#";
  }
}
