import { cn, Input } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuSearch, LuWarehouse } from "react-icons/lu";
import { Link, useLocation, useParams } from "react-router";
import { ItemThumbnail } from "~/components";
import { useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";

// Left sidebar — lists every PL line with a mini progress badge, plus a
// Lines / Walking Order tab. Walking Order sorts by storageUnit hierarchy
// (parent → child) so a printable pick traversal makes physical sense.
export default function PickingListExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("id required");

  const { t } = useLingui();
  const location = useLocation();
  const [tab, setTab] = useState<"lines" | "walking">("lines");
  const [search, setSearch] = useState("");

  const routeData = useRouteData<{
    pickingList: PickingListDetail;
    pickingListLines: PickingListLine[];
  }>(path.to.pickingList(id));

  const lines = routeData?.pickingListLines ?? [];

  const filtered = useMemo(() => {
    let xs = [...lines];
    if (tab === "walking") {
      xs.sort((a, b) => {
        const aName = (a as any).storageUnit?.name ?? "";
        const bName = (b as any).storageUnit?.name ?? "";
        return aName.localeCompare(bName);
      });
    }
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter((l) => {
        const item = (l as any).item;
        return (
          item?.readableId?.toLowerCase().includes(q) ||
          item?.name?.toLowerCase().includes(q)
        );
      });
    }
    return xs;
  }, [lines, tab, search]);

  const selectedLineId = new URLSearchParams(location.search).get("lineId");

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="flex border-b border-border">
        <TabButton
          active={tab === "lines"}
          onClick={() => setTab("lines")}
          label={<Trans>Lines</Trans>}
        />
        <TabButton
          active={tab === "walking"}
          onClick={() => setTab("walking")}
          icon={<LuWarehouse className="h-3 w-3 mr-1" />}
          label={<Trans>Walking order</Trans>}
        />
      </div>

      <div className="p-2 border-b border-border">
        <div className="relative">
          <LuSearch className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t`Search…`}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-accent">
        {filtered.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            <Trans>No lines</Trans>
          </div>
        ) : (
          filtered.map((line, idx) => (
            <LineRow
              key={line.id}
              line={line}
              index={idx + 1}
              isSelected={selectedLineId === line.id}
              picklingListId={id}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center px-3 py-2 text-xs font-medium border-b-2 transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function LineRow({
  line,
  index,
  isSelected,
  picklingListId
}: {
  line: PickingListLine;
  index: number;
  isSelected: boolean;
  picklingListId: string;
}) {
  const item = (line as any).item;
  const required = Number(line.adjustedQuantity ?? line.estimatedQuantity ?? 0);
  const picked = Number(line.pickedQuantity ?? 0);
  const overpick = picked > required;
  const fullyPicked = required > 0 && picked === required;
  const partial = picked > 0 && picked < required;

  return (
    <Link
      to={`${path.to.pickingList(picklingListId)}?lineId=${line.id}`}
      preventScrollReset
      className={cn(
        "flex items-center gap-2 px-2 py-2 border-b border-border/60 hover:bg-muted/40 transition-colors",
        isSelected && "bg-muted"
      )}
    >
      <span className="text-xs text-muted-foreground w-4 text-right tabular-nums">
        {index}
      </span>
      {item ? (
        <ItemThumbnail
          size="sm"
          thumbnailPath={item.thumbnailPath}
          type={(item.type as "Part") ?? "Part"}
        />
      ) : (
        <div className="h-7 w-7 rounded bg-muted" />
      )}
      <div className="flex flex-col flex-1 min-w-0 leading-tight">
        <span className="text-xs font-medium truncate">{item?.name}</span>
        <span className="text-xxs text-muted-foreground truncate">
          {item?.readableId}
        </span>
      </div>
      <span
        className={cn(
          "text-xxs tabular-nums px-1.5 py-0.5 rounded",
          overpick
            ? "bg-red-500/10 text-red-500"
            : fullyPicked
              ? "bg-emerald-500/10 text-emerald-600"
              : partial
                ? "bg-blue-500/10 text-blue-500"
                : "bg-muted text-muted-foreground"
        )}
      >
        {picked}/{required}
      </span>
    </Link>
  );
}
