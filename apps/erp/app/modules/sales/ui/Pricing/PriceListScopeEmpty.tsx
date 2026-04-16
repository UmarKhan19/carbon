import { useLingui } from "@lingui/react/macro";
import { LuUserCheck } from "react-icons/lu";
import { type ScopeOption, ScopePicker } from "./ScopePicker";

type PriceListScopeEmptyProps = {
  scopeOptions: ScopeOption[];
  value: string;
  onChange: (next: string) => void;
};

export function PriceListScopeEmpty({
  scopeOptions,
  value,
  onChange
}: PriceListScopeEmptyProps) {
  const { t } = useLingui();

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-card text-center py-12 px-6">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <LuUserCheck className="w-8 h-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {t`Select a customer or customer type`}
      </p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[320px]">
        {t`Pick a scope to view resolved prices and create price overrides.`}
      </p>
      <div className="mt-5 w-[260px]">
        <ScopePicker
          size="md"
          value={value}
          options={scopeOptions}
          onChange={onChange}
          placeholder={t`Choose scope to continue`}
        />
      </div>
    </div>
  );
}
