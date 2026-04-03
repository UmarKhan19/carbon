import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getPriceListsList } from "~/modules/pricing";
import { path } from "~/utils/path";

type PriceListSelectProps = Omit<ComboboxProps, "options"> & {
  type?: "Sales" | "Purchase";
};

const PriceList = ({ type = "Sales", ...props }: PriceListSelectProps) => {
  const options = usePriceLists(type);

  return (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? "Price List"}
    />
  );
};

PriceList.displayName = "PriceList";

export default PriceList;

export const usePriceLists = (type: "Sales" | "Purchase" = "Sales") => {
  const fetcher = useFetcher<Awaited<ReturnType<typeof getPriceListsList>>>();

  const apiPath =
    type === "Sales"
      ? path.to.api.salesPriceLists
      : path.to.api.purchasePriceLists;

  useMount(() => {
    fetcher.load(apiPath);
  });

  const options = useMemo(() => {
    const dataSource = fetcher.data?.data ?? [];

    return dataSource.map((p) => ({
      value: p.id,
      label: p.name
    }));
  }, [fetcher.data?.data]);

  return options;
};
