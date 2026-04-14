import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { LuChevronRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { PriceTraceStep } from "../pricing.service";

type PriceTracePopoverProps = {
  priceListId: string | null;
  priceListName: string | null;
  priceTrace: unknown;
  currencyCode: string;
};

export function PriceTracePopover({
  priceListId,
  priceListName,
  priceTrace,
  currencyCode
}: PriceTracePopoverProps) {
  if (!priceListName) return null;

  const steps = Array.isArray(priceTrace)
    ? (priceTrace as PriceTraceStep[])
    : [];

  if (steps.length === 0) {
    return (
      <PriceListSourceLink
        priceListId={priceListId}
        priceListName={priceListName}
        className="text-xxs truncate max-w-[160px]"
      />
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xxs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2"
        >
          View calc
          <LuChevronRight className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[620px] p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Pricing trace</p>
          <PriceListSourceLink
            priceListId={priceListId}
            priceListName={priceListName}
            className="text-xs truncate max-w-[320px]"
          />
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Step
              </Th>
              <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                Description
              </Th>
              <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                Change
              </Th>
              <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                Running Total
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {steps.map((step, i) => {
              const isFinal = step.step === "Final Price";
              return (
                <Tr
                  key={i}
                  className={
                    isFinal ? "border-t border-border font-semibold" : undefined
                  }
                >
                  <Td className="text-sm whitespace-nowrap">{step.step}</Td>
                  <Td
                    className="text-sm text-muted-foreground"
                    title={step.source}
                  >
                    {step.ruleId ? (
                      <Link
                        to={path.to.pricingRule(step.ruleId)}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground hover:underline decoration-dotted underline-offset-2 inline-flex items-center gap-1"
                      >
                        {step.source}
                        <LuExternalLink className="size-3 shrink-0" />
                      </Link>
                    ) : (
                      step.source
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ChangeCell step={step} currencyCode={currencyCode} />
                  </Td>
                  <Td className="text-right text-sm font-mono tabular-nums whitespace-nowrap">
                    {formatCurrency(step.amount, currencyCode)}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </PopoverContent>
    </Popover>
  );
}

function PriceListSourceLink({
  priceListId,
  priceListName,
  className
}: {
  priceListId: string | null;
  priceListName: string;
  className?: string;
}) {
  const baseClasses = "text-muted-foreground inline-flex items-center gap-1";
  if (!priceListId) {
    return (
      <span
        className={`${baseClasses} ${className ?? ""}`}
        title={priceListName}
      >
        From: {priceListName}
      </span>
    );
  }
  return (
    <Link
      to={path.to.pricingRule(priceListId)}
      target="_blank"
      rel="noreferrer"
      className={`${baseClasses} ${className ?? ""} hover:text-foreground hover:underline decoration-dotted underline-offset-2`}
      title={`Open ${priceListName}`}
    >
      From: {priceListName}
      <LuExternalLink className="size-3 shrink-0" />
    </Link>
  );
}

function ChangeCell({
  step,
  currencyCode
}: {
  step: PriceTraceStep;
  currencyCode: string;
}) {
  if (step.adjustment === undefined || step.adjustment === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const isDiscount = step.adjustment < 0;
  const classes = isDiscount
    ? "bg-green-500/10 text-green-600 dark:text-green-400"
    : "bg-red-500/10 text-red-600 dark:text-red-400";
  const sign = isDiscount ? "" : "+";
  return (
    <span
      className={`px-2 py-0.5 rounded text-sm font-mono tabular-nums ${classes}`}
    >
      {sign}
      {formatCurrency(step.adjustment, currencyCode)}
    </span>
  );
}

function formatCurrency(value: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode
  }).format(value);
}
