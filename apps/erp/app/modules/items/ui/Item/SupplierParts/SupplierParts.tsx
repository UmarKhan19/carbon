import { Card, CardContent, CardHeader, CardTitle, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Outlet, useNavigate } from "react-router";
import { SupplierAvatar } from "~/components";
import Grid from "~/components/Grid";
import Hyperlink from "~/components/Hyperlink";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierPart } from "../../../types";

type Part = Pick<
  SupplierPart,
  | "id"
  | "supplierId"
  | "supplierPartId"
  | "unitPrice"
  | "supplierUnitOfMeasureCode"
  | "minimumOrderQuantity"
  | "conversionFactor"
  | "customFields"
>;

type SupplierPartsProps = {
  supplierParts: Part[];
  compact?: boolean;
};

const SupplierParts = ({
  supplierParts,
  compact = false
}: SupplierPartsProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "parts");
  const formatter = useCurrencyFormatter();
  const customColumns = useCustomColumns<Part>("supplierPart");

  const columns = useMemo<ColumnDef<Part>[]>(() => {
    const defaultColumns: ColumnDef<Part>[] = [
      {
        accessorKey: "supplierId",
        header: t`Supplier`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>
            <SupplierAvatar supplierId={row.original.supplierId} />
          </Hyperlink>
        )
      },
      {
        accessorKey: "supplierPartId",
        header: t`Supplier ID`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "unitPrice",
        header: t`Unit Price`,
        cell: (item) => formatter.format(item.getValue<number>()),
        meta: {
          formatter: formatter.format,
          renderTotal: true
        }
      },
      {
        accessorKey: "supplierUnitOfMeasureCode",
        header: t`Unit of Measure`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "minimumOrderQuantity",
        header: t`Minimum Order Quantity`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "conversionFactor",
        header: t`Conversion Factor`,
        cell: (item) => item.getValue()
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, formatter, t]);

  return (
    <>
      <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
        <CardHeader className={cn(compact && "px-0")}>
          <CardTitle>
            <Trans>Supplier Parts</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className={cn(compact && "px-0")}>
          <Grid<Part>
            data={supplierParts}
            columns={columns}
            canEdit={false}
            onNewRow={canEdit ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SupplierParts;
