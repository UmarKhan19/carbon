import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Hyperlink } from "~/components";
import Grid from "~/components/Grid";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListStatusType } from "./../types";
import PriceListStatus from "./PriceListStatus";

type PriceListItemRow = {
  id: string;
  unitPrice: number;
  unitOfMeasureCode: string | null;
  priceList: {
    id: string;
    name: string;
    status: string;
    type: string;
    currencyCode: string;
    sequence: number;
    version: number;
  };
};

type ItemPriceListsProps = {
  data: PriceListItemRow[];
};

const ItemPriceLists = ({ data }: ItemPriceListsProps) => {
  const formatter = useCurrencyFormatter();

  const columns = useMemo<ColumnDef<PriceListItemRow>[]>(
    () => [
      {
        id: "name",
        header: "Price List",
        cell: ({ row }) => (
          <Hyperlink to={path.to.priceListDetails(row.original.priceList.id)}>
            {row.original.priceList.name}
          </Hyperlink>
        )
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <PriceListStatus
            status={row.original.priceList.status as PriceListStatusType}
          />
        )
      },
      {
        id: "type",
        header: "Type",
        cell: ({ row }) => row.original.priceList.type
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => formatter.format(row.original.unitPrice)
      },
      {
        id: "currency",
        header: "Currency",
        cell: ({ row }) => row.original.priceList.currencyCode
      }
    ],
    [formatter]
  );

  if (data.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Price Lists</CardTitle>
      </CardHeader>
      <CardContent>
        <Grid<PriceListItemRow> data={data} columns={columns} canEdit={false} />
      </CardContent>
    </Card>
  );
};

export default ItemPriceLists;
