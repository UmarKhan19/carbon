import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Input,
  Location,
  Select,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { incoterms } from "~/modules/shared";
import { path } from "~/utils/path";
import { isQuoteLocked, quoteShipmentValidator } from "../../sales.models";
import type {
  Quotation,
  QuotationLine,
  QuotationPrice,
  SalesOrderLine
} from "../../types";

type QuoteShipmentFormProps = {
  initialValues: z.infer<typeof quoteShipmentValidator>;
  defaultCollapsed?: boolean;
};

export type QuoteShipmentFormRef = {
  focusShippingCost: () => void;
};

const QuoteShipmentForm = forwardRef<
  QuoteShipmentFormRef,
  QuoteShipmentFormProps
>(({ initialValues, defaultCollapsed = false }, ref) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [incoterm, setIncoterm] = useState<string | undefined>(
    initialValues.incoterm || undefined
  );

  const shippingCostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusShippingCost: () => {
      setIsCollapsed(false);
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        shippingCostRef.current?.focus();
      }, 100);
    }
  }));

  const isCustomer = permissions.is("customer");

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
    salesOrderLines: SalesOrderLine[] | null;
  }>(path.to.quote(quoteId));

  const isLocked = isQuoteLocked(routeData?.quote?.status);
  const isEditable = !isLocked;

  const currencyFormatter = useCurrencyFormatter();

  // The shipping cost the user enters lives on the per-quantity line pricing
  // (quoteLinePrice.shippingCost). Surface it here so the Shipping section
  // reflects what was entered instead of always showing the flat $0 field.
  // - Once the quote is ordered, use the ordered quantity's shipping cost.
  // - Otherwise, if every line resolves to a single shipping cost, sum them.
  // - If shipping varies across the quantity options, show "—" (null), since
  //   the amount isn't known until a quantity is chosen.
  const derivedShippingCost = useMemo<number | null>(() => {
    const lines = routeData?.lines ?? [];
    const prices = routeData?.prices ?? [];
    const salesOrderLines = routeData?.salesOrderLines ?? [];
    const isOrdered =
      Array.isArray(salesOrderLines) && salesOrderLines.length > 0;

    // Start from any flat shipping cost stored on the quote shipment.
    let total = initialValues.shippingCost ?? 0;

    for (const line of lines) {
      if (!line.id) continue;
      const linePrices = prices.filter((p) => p.quoteLineId === line.id);
      if (linePrices.length === 0) continue;

      if (isOrdered) {
        const salesOrderLine = salesOrderLines.find(
          (sol) => sol.id === line.id
        );
        if (!salesOrderLine) continue; // line wasn't ordered
        const price = linePrices.find(
          (p) => p.quantity === salesOrderLine.saleQuantity
        );
        total += price?.shippingCost ?? 0;
      } else {
        const relevant = linePrices.filter((p) =>
          line.quantity?.includes(p.quantity)
        );
        const distinct = new Set(relevant.map((p) => p.shippingCost ?? 0));
        if (distinct.size > 1) return null; // varies by quantity
        total += relevant[0]?.shippingCost ?? 0;
      }
    }

    return total;
  }, [
    routeData?.lines,
    routeData?.prices,
    routeData?.salesOrderLines,
    initialValues.shippingCost
  ]);

  return (
    <Card
      ref={cardRef}
      isCollapsible
      defaultCollapsed={defaultCollapsed}
      isCollapsed={isCollapsed}
      onCollapsedChange={setIsCollapsed}
    >
      <ValidatedForm
        action={path.to.quoteShipment(initialValues.id)}
        method="post"
        validator={quoteShipmentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
        isDisabled={isLocked}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Shipping</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          {/* Preserve any flat shipping cost stored on the quote shipment.
              The displayed value is derived from the line pricing (above). */}
          <Hidden name="shippingCost" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t`Shipping Cost`}</span>
              <div
                ref={shippingCostRef}
                tabIndex={-1}
                className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm"
              >
                {derivedShippingCost === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  currencyFormatter.format(derivedShippingCost)
                )}
              </div>
            </div>
            <Location
              name="locationId"
              label={t`Shipment Location`}
              isReadOnly={isCustomer}
              isClearable
            />
            <ShippingMethod
              name="shippingMethodId"
              label={t`Shipping Method`}
            />
            <Select
              name="incoterm"
              label={t`Incoterm`}
              isClearable
              options={incoterms.map((i) => ({ value: i, label: i }))}
              onChange={(v) => setIncoterm(v?.value as string)}
            />
            {incoterm && (
              <Input name="incotermLocation" label={t`Incoterm Location`} />
            )}

            <DatePicker name="receiptRequestedDate" label={t`Requested Date`} />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={!permissions.can("update", "sales") || !isEditable}
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
});

QuoteShipmentForm.displayName = "QuoteShipmentForm";

export default QuoteShipmentForm;
