import {
  Badge,
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
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { LuChevronRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { PriceTraceStep } from "../../types";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const STEP_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant } | null
> = {
  "Base Price": { label: "Base", variant: "gray" },
  Override: { label: "Override", variant: "yellow" },
  "Type Override": { label: "Type Override", variant: "blue" },
  "All Override": { label: "All Override", variant: "gray" },
  Discount: { label: "Discount", variant: "green" },
  Markup: { label: "Markup", variant: "secondary" },
  "Final Price": null
};

type PriceTracePopoverProps = {
  trace: PriceTraceStep[] | null | undefined;
  currencyCode: string;
  /** Optional trigger content. If omitted, renders a "View calc" text button. */
  children?: ReactNode;
};

export function PriceTracePopover({
  trace,
  currencyCode,
  children
}: PriceTracePopoverProps) {
  const { t } = useLingui();
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });
  const format = (value: number) => currencyFormatter.format(value);

  const steps = Array.isArray(trace) ? trace : [];
  if (steps.length === 0) {
    return children ? <>{children}</> : null;
  }

  const trigger = children ? (
    <button
      type="button"
      className="cursor-help decoration-dotted underline-offset-2 hover:underline"
    >
      {children}
    </button>
  ) : (
    <button
      type="button"
      className="text-xxs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2"
    >
      {t`View calc`}
      <LuChevronRight className="size-3" />
    </button>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[720px] p-0">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">{t`Pricing trace`}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t`How the resolved price was calculated.`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  {t`Step`}
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  {t`Type`}
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  {t`Description`}
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                  {t`Change`}
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                  {t`Running Total`}
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
                      isFinal
                        ? "border-t border-border font-semibold"
                        : undefined
                    }
                  >
                    <Td className="text-sm whitespace-nowrap">{step.step}</Td>
                    <Td className="text-sm whitespace-nowrap">
                      <StepTypeBadge step={step} />
                    </Td>
                    <Td
                      className="text-sm text-muted-foreground max-w-[240px]"
                      title={step.source}
                    >
                      {step.ruleId ? (
                        <Link
                          to={path.to.pricingRule(step.ruleId)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline decoration-dotted underline-offset-2 inline-flex items-center gap-1 max-w-full"
                        >
                          <span className="truncate">{step.source}</span>
                          <LuExternalLink className="size-3 shrink-0" />
                        </Link>
                      ) : (
                        <span className="block truncate">{step.source}</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <DeltaPill value={step.adjustment} format={format} />
                    </Td>
                    <Td className="text-right text-sm font-mono tabular-nums whitespace-nowrap">
                      {format(step.amount)}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StepTypeBadge({ step }: { step: PriceTraceStep }) {
  const mapping = STEP_BADGE[step.step];
  if (mapping === null) return null;
  if (!mapping) return <Badge variant="gray">{step.step}</Badge>;
  return <Badge variant={mapping.variant}>{mapping.label}</Badge>;
}

export function DeltaPill({
  value,
  format
}: {
  value: number | undefined;
  format: (value: number) => string;
}) {
  if (value === undefined || value === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const isDiscount = value < 0;
  const classes = isDiscount
    ? "bg-green-500/10 text-green-600 dark:text-green-400"
    : "bg-red-500/10 text-red-600 dark:text-red-400";
  const sign = isDiscount ? "" : "+";
  return (
    <span
      className={`px-2 py-0.5 rounded text-sm font-mono tabular-nums ${classes}`}
    >
      {sign}
      {format(value)}
    </span>
  );
}
