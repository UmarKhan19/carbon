import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import ItemLink from "./ItemLink";

export type ProductAffected = {
  id: string;
  itemId: string;
  item: {
    id: string;
    readableIdWithRevision: string | null;
    name: string | null;
    type: string | null;
  } | null;
  // The targeted assemblies that rolled up into this product.
  affectedBy: Array<{
    id: string;
    readableIdWithRevision: string | null;
    name: string | null;
  }>;
};

// Products Affected are DERIVED from the BOM changes (the top-level products the
// targeted assemblies roll up into) and recomputed whenever a BOM change is saved.
// This card is read-only by design — editing it directly would let it drift from
// the BOM changes.
export default function ProductsAffected({
  products
}: {
  products: ProductAffected[];
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Products Affected</Trans>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          <Trans>Derived automatically from the BOM changes below.</Trans>
        </span>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          {products.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              <Trans>
                No products affected yet — add a BOM change to populate this.
              </Trans>
            </span>
          ) : (
            products.map((product) => (
              <HStack
                key={product.id}
                className="w-full justify-between border-b border-border py-2"
              >
                <VStack spacing={0}>
                  <ItemLink
                    itemId={product.item?.id ?? product.itemId}
                    type={product.item?.type}
                    className="text-sm font-medium"
                  >
                    {product.item?.readableIdWithRevision ?? product.itemId}
                  </ItemLink>
                  {product.item?.name && (
                    <span className="text-xs text-muted-foreground">
                      {product.item.name}
                    </span>
                  )}
                  {product.affectedBy.length > 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      (affected by{" "}
                      {product.affectedBy
                        .map((a) => a.readableIdWithRevision ?? a.id)
                        .join(", ")}
                      )
                    </span>
                  )}
                </VStack>
              </HStack>
            ))
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
