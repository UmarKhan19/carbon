// biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
import { Number, Select, ValidatedForm } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle, toast } from "@carbon/react";
import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import { usePermissions } from "~/hooks";
import type { action } from "~/routes/x+/issue+/item+/update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { disposition, itemQuantityValidator } from "../../quality.models";
import type { IssueAssociationNode } from "../../types";
import { DispositionStatus } from "./DispositionStatus";

type AssociatedItemsListProps = {
  associatedItems: IssueAssociationNode["children"];
};

export function AssociatedItemsList({
  associatedItems
}: AssociatedItemsListProps) {
  const [items] = useItems();
  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdateDisposition = useCallback(
    (nonConformanceItemId: string, dispositionValue: string | null) => {
      const formData = new FormData();
      formData.append("id", nonConformanceItemId);
      formData.append("field", "disposition");
      formData.append("value", dispositionValue ?? "");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateIssueItem
      });
    },
    [fetcher]
  );

  const onUpdateQuantity = useCallback(
    (nonConformanceItemId: string, quantityValue: number | null) => {
      const formData = new FormData();
      formData.append("id", nonConformanceItemId);
      formData.append("field", "quantity");
      formData.append("value", quantityValue?.toString() ?? "0");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateIssueItem
      });
    },
    [fetcher]
  );

  if (!associatedItems || associatedItems.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {associatedItems.length > 1 ? "Dispositions" : "Disposition"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {associatedItems
            // @ts-expect-error TS2339 - TODO: fix type
            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
            .map((child) => {
              // Resolve item information from the items store using documentId
              const item = items.find((i) => i.id === child.documentId);

              if (!item) return null;

              return (
                <li
                  key={child.id}
                  className="bg-muted/30 border border-border rounded-lg w-full px-6 py-4"
                >
                  <div className="flex items-center justify-between w-full gap-4">
                    <div className="flex flex-col flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">
                          {item.readableIdWithRevision}
                        </h3>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-end gap-2 flex-shrink-0">
                      <ValidatedForm
                        defaultValues={{
                          quantity: (child as any).quantity ?? 0
                        }}
                        validator={itemQuantityValidator}
                        className="w-24"
                      >
                        <Number
                          label="Quantity"
                          name="quantity"
                          isReadOnly={!permissions.can("update", "quality")}
                          minValue={0}
                          size="sm"
                          onBlur={(e) => {
                            const target = e.target as HTMLInputElement;
                            const numValue = parseFloat(target.value) || 0;
                            onUpdateQuantity(child.id, numValue);
                          }}
                        />
                      </ValidatedForm>
                      <ValidatedForm
                        defaultValues={{
                          disposition: (child as any).disposition ?? "Pending"
                        }}
                        validator={z.object({
                          disposition: z.string().optional()
                        })}
                        className="flex-shrink-0 items-center"
                      >
                        <Select
                          options={disposition.map((d) => ({
                            value: d,
                            label: <DispositionStatus disposition={d} />
                          }))}
                          isReadOnly={!permissions.can("update", "quality")}
                          label="Status"
                          name="disposition"
                          inline={(value) => {
                            return (
                              <div className="h-8 flex items-center">
                                <DispositionStatus disposition={value} />
                              </div>
                            );
                          }}
                          onChange={(value) => {
                            if (value) {
                              onUpdateDisposition(child.id, value.value);
                            }
                          }}
                        />
                      </ValidatedForm>
                    </div>
                  </div>
                </li>
              );
            })}
        </ul>
      </CardContent>
    </Card>
  );
}
