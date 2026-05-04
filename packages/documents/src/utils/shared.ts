export const formatTaxPercent = (
  taxPercent: number | null | undefined
): string | null => {
  if (!taxPercent) return null;
  return `${(taxPercent * 100).toFixed(0)}%`;
};

export const getCurrencyFormatter = (
  baseCurrencyCode: string,
  locale: string,
  maximumFractionDigits?: number
) => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: baseCurrencyCode,
    maximumFractionDigits: maximumFractionDigits ?? 2
  });
};
