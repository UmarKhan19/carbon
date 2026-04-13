import {
  cn,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type React from "react";
import { useMemo } from "react";
import { LuInfo, LuLoaderCircle } from "react-icons/lu";
import { NumberControlled } from "~/components/Form";

interface ExchangeRateProps
  extends React.ComponentProps<typeof NumberControlled> {
  inline?: boolean;
  onRefresh?: () => void;
  exchangeRateUpdatedAt: string | undefined;
}

const ExchangeRate: React.FC<ExchangeRateProps> = ({
  onRefresh,
  inline = false,
  exchangeRateUpdatedAt,
  value,
  ...props
}) => {
  const { t } = useLingui();
  const { locale } = useLocale();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short"
      }),
    [locale]
  );

  const formattedDate = exchangeRateUpdatedAt
    ? formatter.format(new Date(exchangeRateUpdatedAt))
    : "";

  return (
    <div className="relative">
      <HStack spacing={0} className="items-end">
        {inline ? (
          <VStack spacing={2}>
            <HStack className="w-full justify-between">
              <span className="text-xs text-muted-foreground">
                <Trans>Exchange Rate</Trans>
              </span>
              {exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <Trans>Last updated: {formattedDate}</Trans>
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{value}</span>
            </HStack>
          </VStack>
        ) : (
          <NumberControlled
            label={
              <HStack spacing={1}>
                <span>
                  <Trans>Exchange Rate</Trans>
                </span>
                {exchangeRateUpdatedAt && (
                  <Tooltip>
                    <TooltipTrigger tabIndex={-1}>
                      <LuInfo className="w-4 h-4" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>Last updated: {formattedDate}</Trans>
                    </TooltipContent>
                  </Tooltip>
                )}
              </HStack>
            }
            {...props}
            value={value}
            isReadOnly
            className={cn("z-10", onRefresh ? "rounded-r-none" : "")}
          />
        )}

        {onRefresh && (
          <IconButton
            aria-label={t`Refresh exchange rate`}
            className="flex-shrink-0 h-10 w-10 px-3 rounded-l-none border-l-0 shadow-sm"
            icon={<LuLoaderCircle />}
            variant="secondary"
            size="md"
            onClick={onRefresh}
          />
        )}
      </HStack>
    </div>
  );
};

export default ExchangeRate;
