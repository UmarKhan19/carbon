import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import type { ChangeOrderImpactItem } from "~/modules/items";

type ImpactCategory = {
  label: string;
  rows: Array<{ id: string; documentReadableId: string | null }>;
};

function CategoryRow({ label, rows }: ImpactCategory) {
  return (
    <HStack className="justify-between w-full">
      <span className="text-sm text-muted-foreground">{label}</span>
      {rows.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <HStack spacing={1} className="flex-wrap justify-end">
          <Badge variant="secondary">{rows.length}</Badge>
          {rows.slice(0, 8).map((r) => (
            <Badge key={r.id} variant="outline">
              {r.documentReadableId ?? "—"}
            </Badge>
          ))}
          {rows.length > 8 && (
            <span className="text-xs text-muted-foreground">
              +{rows.length - 8} more
            </span>
          )}
        </HStack>
      )}
    </HStack>
  );
}

// Read-only "where used" blast radius for the change order's affected items —
// the jobs, purchase orders, sales orders, and parent BOMs that reference each
// item today. Advisory only; it never blocks release.
export default function ChangeOrderImpact({
  impact
}: {
  impact: ChangeOrderImpactItem[];
}) {
  if (impact.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where Used</CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {impact.map((item) => {
            const total =
              item.jobs.length +
              item.purchaseOrderLines.length +
              item.salesOrderLines.length +
              item.parentBoms.length;
            return (
              <VStack key={item.itemId} spacing={2} className="w-full">
                <HStack className="justify-between w-full">
                  <span className="text-sm font-medium">
                    {item.itemReadableId ?? item.itemId}
                  </span>
                  {total === 0 && (
                    <span className="text-sm text-muted-foreground">
                      Not currently in use
                    </span>
                  )}
                </HStack>
                {total > 0 && (
                  <VStack spacing={1} className="w-full pl-2">
                    <CategoryRow label="Open jobs" rows={item.jobs} />
                    <CategoryRow
                      label="Purchase orders"
                      rows={item.purchaseOrderLines}
                    />
                    <CategoryRow
                      label="Sales orders"
                      rows={item.salesOrderLines}
                    />
                    <CategoryRow label="Parent BOMs" rows={item.parentBoms} />
                  </VStack>
                )}
              </VStack>
            );
          })}
        </VStack>
      </CardContent>
    </Card>
  );
}
