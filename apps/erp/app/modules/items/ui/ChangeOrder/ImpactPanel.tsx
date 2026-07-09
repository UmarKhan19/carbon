import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ChangeOrderImpactRow } from "../../changeOrder.service";

// PRD §3.3: read-only, non-blocking view of open (not-yet-received) purchase
// order lines for parts being deleted by this change order. Purely informational
// so procurement has visibility before the change goes live.
export default function ImpactPanel({
  impact
}: {
  impact: ChangeOrderImpactRow[];
}) {
  const openLineCount = impact.reduce(
    (total, row) => total + row.openPurchaseOrderLines.length,
    0
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Impact</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {openLineCount === 0 ? (
          <span className="text-sm text-muted-foreground italic">
            <Trans>No open purchase orders for deleted parts</Trans>
          </span>
        ) : (
          <VStack spacing={4}>
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-light">
              <Trans>{openLineCount} open POs for deleted parts</Trans>
            </span>
            {impact
              .filter((row) => row.openPurchaseOrderLines.length > 0)
              .map((row) => (
                <VStack key={row.itemId} spacing={2}>
                  <VStack spacing={0}>
                    <span className="text-sm font-medium">
                      {row.itemReadableId ?? row.itemId}
                    </span>
                    {row.itemName && (
                      <span className="text-xs text-muted-foreground">
                        {row.itemName}
                      </span>
                    )}
                  </VStack>
                  <VStack spacing={1} className="pl-2">
                    {row.openPurchaseOrderLines.map((line) => (
                      <HStack
                        key={line.id}
                        className="w-full justify-between border-b border-border py-1"
                      >
                        <span className="text-sm">
                          {line.purchaseOrderReadableId ?? line.purchaseOrderId}
                        </span>
                        <HStack
                          spacing={4}
                          className="text-xs text-muted-foreground"
                        >
                          {line.supplierName && (
                            <span>{line.supplierName}</span>
                          )}
                          <span>
                            <Trans>
                              Qty to receive: {line.quantityToReceive ?? 0}
                            </Trans>
                          </span>
                        </HStack>
                      </HStack>
                    ))}
                  </VStack>
                </VStack>
              ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
}
