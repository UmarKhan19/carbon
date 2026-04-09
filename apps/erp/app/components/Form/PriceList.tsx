import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getPriceListsList } from "~/modules/pricing";
import { path } from "~/utils/path";

type PriceListSelectProps = Omit<ComboboxProps, "options">;

const PriceList = (props: PriceListSelectProps) => {
  const options = usePriceLists();

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

export const usePriceLists = () => {
  const fetcher = useFetcher<Awaited<ReturnType<typeof getPriceListsList>>>();

  useMount(() => {
    fetcher.load(path.to.api.salesPriceLists);
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
