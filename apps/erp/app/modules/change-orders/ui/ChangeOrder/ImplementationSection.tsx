import { DatePicker, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import { usePermissions } from "~/hooks";
import type { action } from "~/routes/x+/change-order+/update";
import { path } from "~/utils/path";
import { isChangeOrderLocked } from "../../change-orders.models";
import type { ProductAffected } from "./ProductsAffected";

// PRD §3.2: shown from the Implementation stage onward. Surfaces the effectivity
// date (inline-editable) and the effectivity version (the read-only list of
// Products Affected).
export default function ImplementationSection({
  changeOrderId,
  effectiveDate,
  status,
  products
}: {
  changeOrderId: string;
  effectiveDate: string | null;
  status: string | null;
  products: ProductAffected[];
}) {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isLocked = isChangeOrderLocked(status);
  const canUpdate = permissions.can("update", "parts");

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdate = useCallback(
    (value: string | null) => {
      const formData = new FormData();
      formData.append("id", changeOrderId);
      formData.append("field", "effectiveDate");
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateChangeOrder
      });
    },
    [changeOrderId, fetcher]
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Implementation</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <ValidatedForm
            defaultValues={{ effectiveDate: effectiveDate ?? "" }}
            validator={z.object({ effectiveDate: z.string().optional() })}
            className="w-full max-w-[400px]"
          >
            <DatePicker
              name="effectiveDate"
              label={t`Effectivity date`}
              isDisabled={!canUpdate || isLocked}
              onChange={(date) => onUpdate(date)}
            />
          </ValidatedForm>

          <VStack spacing={2}>
            <h3 className="text-xs text-muted-foreground">
              <Trans>Effectivity version</Trans>
            </h3>
            {products.length === 0 ? (
              <span className="text-sm text-muted-foreground italic">
                <Trans>No products affected yet.</Trans>
              </span>
            ) : (
              <VStack spacing={0}>
                {products.map((product) => (
                  <VStack
                    key={product.id}
                    spacing={0}
                    className="w-full border-b border-border py-2"
                  >
                    <span className="text-sm font-medium">
                      {product.item?.readableIdWithRevision ?? product.itemId}
                    </span>
                    {product.item?.name && (
                      <span className="text-xs text-muted-foreground">
                        {product.item.name}
                      </span>
                    )}
                  </VStack>
                ))}
              </VStack>
            )}
          </VStack>
        </VStack>
      </CardContent>
    </Card>
  );
}
