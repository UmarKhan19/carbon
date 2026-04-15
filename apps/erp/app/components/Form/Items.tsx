import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useMemo } from "react";
import { useItems } from "~/stores";

type ItemsSelectProps = Omit<CreatableMultiSelectProps, "options">;

const Items = (props: ItemsSelectProps) => {
  const [items] = useItems();

  const options = useMemo(
    () =>
      items
        .filter((item) => item.active)
        .map((item) => ({
          value: item.id,
          label: item.readableIdWithRevision,
          helper: item.name
        })),
    [items]
  );

  return (
    <CreatableMultiSelect
      options={options}
      {...props}
      label={props?.label ?? "Items"}
    />
  );
};

Items.displayName = "Items";

export default Items;
