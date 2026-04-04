import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { Badge, Combobox as ComboboxBase, useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { AccountClass, getAccountsList } from "~/modules/accounting";
import { path } from "~/utils/path";

const badgeColors: Record<
  string,
  "green" | "red" | "blue" | "yellow" | "orange"
> = {
  Asset: "green",
  Liability: "red",
  Equity: "blue",
  Revenue: "yellow",
  Expense: "orange"
};

function useAccountOptions(classes?: AccountClass[]) {
  const accountFetcher =
    useFetcher<Awaited<ReturnType<typeof getAccountsList>>>();

  useMount(() => {
    const classQueryParams = classes?.map((c) => `class=${c}`).join("&") ?? "";
    accountFetcher.load(
      `${path.to.api.accounts}?isGroup=false&${classQueryParams}`
    );
  });

  const options = useMemo(
    () =>
      accountFetcher.data?.data
        ? accountFetcher.data?.data.map((c) => ({
            value: c.number,
            label: (
              <div className="flex items-center justify-between w-full gap-2">
                <span className="truncate">{c.name}</span>
                {c.class && (
                  <Badge variant={badgeColors[c.class]}>{c.class}</Badge>
                )}
              </div>
            ),
            helper: c.number
          }))
        : [],
    [accountFetcher.data]
  );

  return options;
}

type AccountSelectProps = Omit<ComboboxProps, "options"> & {
  classes?: AccountClass[];
};

const Account = ({ classes, ...props }: AccountSelectProps) => {
  const options = useAccountOptions(classes);

  return (
    <Combobox options={options} {...props} label={props?.label ?? "Account"} />
  );
};

Account.displayName = "Account";

export default Account;

type AccountControlledProps = {
  classes?: AccountClass[];
  value?: string;
  onChange?: (selected: string) => void;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
  isReadOnly?: boolean;
};

export const AccountControlled = ({
  classes,
  ...props
}: AccountControlledProps) => {
  const options = useAccountOptions(classes);

  return <ComboboxBase options={options} {...props} />;
};

AccountControlled.displayName = "AccountControlled";
