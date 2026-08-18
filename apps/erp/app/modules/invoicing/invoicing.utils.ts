import { isBalanced } from "@carbon/utils";

export type InvoiceSettlementRow = {
  id: string | null;
  totalAmount: number | null;
  balance: number | null;
  currencyCode: string | null;
  exchangeRate: number | null;
};

export type InvoiceSettlementValues = {
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
};

export type InvoiceSettlementSummary = {
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  includedInvoiceCount: number;
  currencyMismatchCount: number;
  invalidExchangeRateCount: number;
};

export function getMissingInvoiceIds(
  requestedInvoiceIds: readonly string[],
  returnedInvoices: readonly Pick<InvoiceSettlementRow, "id">[]
): string[] {
  const returnedInvoiceIds = new Set(
    returnedInvoices
      .map((invoice) => invoice.id)
      .filter((id): id is string => Boolean(id))
  );

  return [...new Set(requestedInvoiceIds)].filter(
    (invoiceId) => !returnedInvoiceIds.has(invoiceId)
  );
}

export function getInvoiceSettlementValues(
  invoice: Pick<InvoiceSettlementRow, "id" | "totalAmount" | "balance">
): InvoiceSettlementValues {
  const { totalAmount, balance } = invoice;
  if (
    typeof totalAmount !== "number" ||
    !Number.isFinite(totalAmount) ||
    typeof balance !== "number" ||
    !Number.isFinite(balance)
  ) {
    throw new Error(
      `Invoice ${invoice.id ?? "unknown"} has invalid settlement totals`
    );
  }

  const amountPaid = totalAmount - balance;
  if (!Number.isFinite(amountPaid)) {
    throw new Error(
      `Invoice ${invoice.id ?? "unknown"} has invalid settlement totals`
    );
  }

  return {
    totalAmount,
    amountPaid,
    balanceRemaining: balance
  };
}

/**
 * Convert one already-validated invoice settlement to its invoice currency for
 * presentation. Base settlement values remain usable when this metadata is
 * unavailable or invalid.
 */
export function getInvoicePresentationSettlement(
  invoice: Pick<InvoiceSettlementRow, "currencyCode" | "exchangeRate">,
  settlement: InvoiceSettlementValues
): InvoiceSettlementValues | null {
  const exchangeRate = invoice.exchangeRate;
  if (
    !invoice.currencyCode ||
    typeof exchangeRate !== "number" ||
    !Number.isFinite(exchangeRate) ||
    exchangeRate <= 0
  ) {
    return null;
  }

  const converted = {
    totalAmount: settlement.totalAmount * exchangeRate,
    amountPaid: settlement.amountPaid * exchangeRate,
    balanceRemaining: settlement.balanceRemaining * exchangeRate
  };

  return Object.values(converted).every(Number.isFinite) ? converted : null;
}

/**
 * Aggregate invoice view settlement values without rebuilding settlement state.
 * `totalAmount` and `balance` are read from the same invoice-view row, so the
 * paid amount remains authoritative even when settlement came from a discount,
 * write-off, memo, or a partially applied payment.
 *
 * A target currency is required for every aggregate. Rows without an
 * established matching currency are excluded rather than treated as
 * compatible. Only finite positive exchange rates are accepted, including for
 * non-converted aggregates, so unknown metadata never produces a settlement
 * value.
 */
export function getInvoiceSettlementSummary(
  invoices: readonly InvoiceSettlementRow[],
  options: {
    targetCurrency?: string | null;
    convertToTarget?: boolean;
  } = {}
): InvoiceSettlementSummary {
  const seenInvoiceIds = new Set<string>();
  let totalAmount = 0;
  let balanceRemaining = 0;
  let includedInvoiceCount = 0;
  let currencyMismatchCount = 0;
  let invalidExchangeRateCount = 0;

  for (const invoice of invoices) {
    if (invoice.id) {
      if (seenInvoiceIds.has(invoice.id)) continue;
      seenInvoiceIds.add(invoice.id);
    }

    const settlement = getInvoiceSettlementValues(invoice);

    if (
      !options.targetCurrency ||
      !invoice.currencyCode ||
      invoice.currencyCode !== options.targetCurrency
    ) {
      currencyMismatchCount += 1;
      continue;
    }

    const exchangeRate = invoice.exchangeRate;
    if (
      typeof exchangeRate !== "number" ||
      !Number.isFinite(exchangeRate) ||
      exchangeRate <= 0
    ) {
      invalidExchangeRateCount += 1;
      continue;
    }

    const conversionRate = options.convertToTarget ? exchangeRate : 1;
    totalAmount += settlement.totalAmount * conversionRate;
    balanceRemaining += settlement.balanceRemaining * conversionRate;
    includedInvoiceCount += 1;
  }

  return {
    totalAmount,
    amountPaid: totalAmount - balanceRemaining,
    balanceRemaining,
    includedInvoiceCount,
    currencyMismatchCount,
    invalidExchangeRateCount
  };
}

/**
 * Aggregate invoice paid state must use float-noise semantics, not the
 * currency's display rounding. Invoice views already own invoice-level dust
 * normalization. A linked zero-value invoice is not a meaningful settlement.
 */
export function isInvoiceSettlementSettled(
  summary: Pick<
    InvoiceSettlementSummary,
    | "totalAmount"
    | "balanceRemaining"
    | "includedInvoiceCount"
    | "currencyMismatchCount"
    | "invalidExchangeRateCount"
  >
): boolean {
  return (
    summary.includedInvoiceCount > 0 &&
    summary.currencyMismatchCount === 0 &&
    summary.invalidExchangeRateCount === 0 &&
    summary.totalAmount > 0 &&
    !isBalanced(summary.totalAmount, 0) &&
    isBalanced(summary.balanceRemaining, 0)
  );
}
