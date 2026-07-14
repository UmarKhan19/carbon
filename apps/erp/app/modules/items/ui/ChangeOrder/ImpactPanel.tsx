import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck, LuHardHat, LuShoppingCart } from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { ChangeOrderImpact } from "../../changeOrder.service";

// Grouping shell: an item header (id + name) with a count chip, then the caller's
// column header row and line rows. Shared by all three impact sections.
function Group({
  itemReadableId,
  itemName,
  tag,
  count,
  countLabel,
  columns,
  children
}: {
  itemReadableId: string | null;
  itemName: string | null;
  tag?: ReactNode;
  count: number;
  countLabel: ReactNode;
  columns: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border">
      <HStack className="w-full justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2">
        <HStack spacing={2} className="min-w-0">
          <VStack spacing={0} className="min-w-0">
            <span className="truncate text-sm font-medium">
              {itemReadableId ?? "—"}
            </span>
            {itemName && (
              <span className="truncate text-xs text-muted-foreground">
                {itemName}
              </span>
            )}
          </VStack>
          {tag}
        </HStack>
        <Badge variant="outline" className="shrink-0">
          {count} {countLabel}
        </Badge>
      </HStack>
      {columns}
      {children}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <VStack spacing={0} className="w-full">
      <HStack spacing={2}>
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium">{title}</span>
      </HStack>
      <span className="text-xs text-muted-foreground">{description}</span>
    </VStack>
  );
}

const COLS = "grid grid-cols-[1fr_1fr_auto] gap-3 px-3";
const COL_HEAD = `${COLS} pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground`;
const COL_ROW = `${COLS} items-center border-t border-border py-1.5 text-sm`;

// PRD §3.3 (expanded): a non-blocking, read-only heads-up on the in-flight work
// and inventory a release touches. Three sections — jobs, sales, purchasing —
// each shown only when it has rows. Nothing here gates the release.
export default function ImpactPanel({ impact }: { impact: ChangeOrderImpact }) {
  const { affectedJobs, supersededSalesOrders, removedParts } = impact;
  const hasAny =
    affectedJobs.length > 0 ||
    supersededSalesOrders.length > 0 ||
    removedParts.length > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Impact</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          <Trans>
            In-flight work and inventory this release touches. Informational —
            nothing here blocks releasing.
          </Trans>
        </span>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <HStack spacing={2} className="text-sm text-muted-foreground">
            <LuCircleCheck className="size-4 shrink-0 text-emerald-500" />
            <Trans>Nothing downstream is affected by this release.</Trans>
          </HStack>
        ) : (
          <VStack spacing={8}>
            {affectedJobs.length > 0 && (
              <VStack spacing={2}>
                <SectionHeader
                  icon={<LuHardHat className="size-4" />}
                  title={<Trans>Jobs in progress</Trans>}
                  description={
                    <Trans>
                      These jobs were built on the previous method and won't
                      change when you release — finish them as-is or re-pull the
                      method.
                    </Trans>
                  }
                />
                {affectedJobs.map((row) => (
                  <Group
                    key={row.itemId}
                    itemReadableId={row.itemReadableId}
                    itemName={row.itemName}
                    count={row.jobs.length}
                    countLabel={<Trans>open job(s)</Trans>}
                    columns={
                      <div className={COL_HEAD}>
                        <span>
                          <Trans>Job</Trans>
                        </span>
                        <span>
                          <Trans>Status</Trans>
                        </span>
                        <span className="text-right">
                          <Trans>Qty</Trans>
                        </span>
                      </div>
                    }
                  >
                    {row.jobs.map((job) => (
                      <div key={job.id} className={COL_ROW}>
                        <Link
                          to={path.to.jobDetails(job.id)}
                          className="truncate text-foreground hover:underline"
                        >
                          {job.jobReadableId}
                        </Link>
                        <span className="truncate text-muted-foreground">
                          {job.status}
                        </span>
                        <span className="text-right tabular-nums">
                          {job.quantity ?? 0}
                        </span>
                      </div>
                    ))}
                  </Group>
                ))}
              </VStack>
            )}

            {supersededSalesOrders.length > 0 && (
              <VStack spacing={2}>
                <SectionHeader
                  icon={<RiProgress8Line className="size-4" />}
                  title={<Trans>Sales orders</Trans>}
                  description={
                    <Trans>
                      Open sales lines still reference the part being replaced.
                      Move them to the successor if the change should apply.
                    </Trans>
                  }
                />
                {supersededSalesOrders.map((row) => (
                  <Group
                    key={row.itemId}
                    itemReadableId={row.itemReadableId}
                    itemName={row.itemName}
                    tag={
                      <Badge variant="gray" className="shrink-0">
                        {row.changeType}
                      </Badge>
                    }
                    count={row.lines.length}
                    countLabel={<Trans>open line(s)</Trans>}
                    columns={
                      <div className={COL_HEAD}>
                        <span>
                          <Trans>Sales order</Trans>
                        </span>
                        <span>
                          <Trans>Promised</Trans>
                        </span>
                        <span className="text-right">
                          <Trans>To send</Trans>
                        </span>
                      </div>
                    }
                  >
                    {row.lines.map((line) => (
                      <div key={line.id} className={COL_ROW}>
                        <Link
                          to={path.to.salesOrderDetails(line.salesOrderId)}
                          className="truncate text-foreground hover:underline"
                        >
                          {line.salesOrderReadableId ?? line.salesOrderId}
                        </Link>
                        <span className="truncate text-muted-foreground">
                          {line.promisedDate ?? "—"}
                        </span>
                        <span className="text-right tabular-nums">
                          {line.quantityToSend ?? 0}
                        </span>
                      </div>
                    ))}
                  </Group>
                ))}
              </VStack>
            )}

            {removedParts.length > 0 && (
              <VStack spacing={2}>
                <SectionHeader
                  icon={<LuShoppingCart className="size-4" />}
                  title={<Trans>Purchasing</Trans>}
                  description={
                    <Trans>
                      Open purchase orders are still inbound for components this
                      change removes from a BOM.
                    </Trans>
                  }
                />
                {removedParts.map((row) => (
                  <Group
                    key={row.itemId}
                    itemReadableId={row.itemReadableId}
                    itemName={row.itemName}
                    count={row.openPurchaseOrderLines.length}
                    countLabel={<Trans>open line(s)</Trans>}
                    columns={
                      <div className={COL_HEAD}>
                        <span>
                          <Trans>Purchase order</Trans>
                        </span>
                        <span>
                          <Trans>Supplier</Trans>
                        </span>
                        <span className="text-right">
                          <Trans>To receive</Trans>
                        </span>
                      </div>
                    }
                  >
                    {row.openPurchaseOrderLines.map((line) => (
                      <div key={line.id} className={COL_ROW}>
                        <Link
                          to={path.to.purchaseOrderDetails(
                            line.purchaseOrderId
                          )}
                          className="truncate text-foreground hover:underline"
                        >
                          {line.purchaseOrderReadableId ?? line.purchaseOrderId}
                        </Link>
                        <span className="truncate text-muted-foreground">
                          {line.supplierName ?? "—"}
                        </span>
                        <span className="text-right tabular-nums">
                          {line.quantityToReceive ?? 0}
                        </span>
                      </div>
                    ))}
                  </Group>
                ))}
              </VStack>
            )}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
}
