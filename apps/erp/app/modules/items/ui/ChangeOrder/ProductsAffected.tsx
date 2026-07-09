import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Item, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderProductAffectedValidator } from "../../changeOrder.models";

export type ProductAffected = {
  id: string;
  itemId: string;
  item: {
    id: string;
    readableIdWithRevision: string | null;
    name: string | null;
    type: string | null;
  } | null;
};

export default function ProductsAffected({
  changeOrderId,
  products,
  isDisabled
}: {
  changeOrderId: string;
  products: ProductAffected[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();

  const addFetcher = useFetcher<{ success: boolean }>();

  const alreadyAdded = products.map((p) => p.itemId);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Products Affected</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          {products.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              <Trans>No products affected yet.</Trans>
            </span>
          ) : (
            products.map((product) => (
              <ProductRow
                key={product.id}
                changeOrderId={changeOrderId}
                product={product}
                isDisabled={isDisabled}
              />
            ))
          )}

          {!isDisabled && (
            <ValidatedForm
              fetcher={addFetcher}
              method="post"
              action={path.to.changeOrderProduct(changeOrderId)}
              validator={changeOrderProductAffectedValidator}
              defaultValues={{ changeOrderId, itemId: "" }}
              className="w-full"
              resetAfterSubmit
            >
              <Hidden name="changeOrderId" value={changeOrderId} />
              <HStack className="w-full items-end gap-2">
                <div className="flex-grow">
                  <Item
                    name="itemId"
                    label={t`Add product`}
                    type="Item"
                    blacklist={alreadyAdded}
                  />
                </div>
                <Submit>
                  <Trans>Add</Trans>
                </Submit>
              </HStack>
            </ValidatedForm>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ProductRow({
  changeOrderId,
  product,
  isDisabled
}: {
  changeOrderId: string;
  product: ProductAffected;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (deleteFetcher.data && !deleteFetcher.data.success) {
      toast.error(t`Failed to remove product`);
    }
  }, [deleteFetcher.data, t]);

  return (
    <HStack className="w-full justify-between border-b border-border py-2">
      <VStack spacing={0}>
        <span className="text-sm font-medium">
          {product.item?.readableIdWithRevision ?? product.itemId}
        </span>
        {product.item?.name && (
          <span className="text-xs text-muted-foreground">
            {product.item.name}
          </span>
        )}
      </VStack>
      {!isDisabled && (
        <deleteFetcher.Form
          method="post"
          action={path.to.deleteChangeOrderProduct(changeOrderId, product.id)}
        >
          <IconButton
            type="submit"
            aria-label={t`Remove product`}
            variant="ghost"
            icon={<LuTrash2 />}
          />
        </deleteFetcher.Form>
      )}
    </HStack>
  );
}
