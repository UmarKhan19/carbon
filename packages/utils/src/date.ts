import {
  getLocalTimeZone,
  parseAbsolute,
  parseDate,
  toZoned
} from "@internationalized/date";

const DEFAULT_LOCALE = "en-US";

const DIVISIONS: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, name: "seconds" },
  { amount: 60, name: "minutes" },
  { amount: 24, name: "hours" },
  { amount: 7, name: "days" },
  { amount: 4.34524, name: "weeks" },
  { amount: 12, name: "months" },
  { amount: Number.POSITIVE_INFINITY, name: "years" }
];

const defaultFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeZone: getLocalTimeZone()
};

// `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` constructors are
// expensive (locale data lookup + ICU init). These caches reuse the
// formatter for the default-options call sites — `formatDate(d)` in tables
// and `formatTimeAgo(t)` in feeds run thousands of times per render.
// Custom-options calls fall through to a fresh formatter to avoid hashing
// the options bag.
const defaultDateFormatters = new Map<string, Intl.DateTimeFormat>();
function getDefaultDateFormatter(locale: string): Intl.DateTimeFormat {
  let f = defaultDateFormatters.get(locale);
  if (f === undefined) {
    f = new Intl.DateTimeFormat(locale, defaultFormatOptions);
    defaultDateFormatters.set(locale, f);
  }
  return f;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
function getRelativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let f = relativeFormatters.get(locale);
  if (f === undefined) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, f);
  }
  return f;
}

export function convertDateStringToIsoString(dateString: string) {
  return new Date(dateString).toISOString();
}

export function formatDate(
  dateString?: string | null,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
) {
  if (!dateString) return "";
  const _locale = locale || DEFAULT_LOCALE;
  const formatter = options
    ? new Intl.DateTimeFormat(_locale, options)
    : getDefaultDateFormatter(_locale);
  try {
    const _dateString = toZoned(
      parseDate(dateString),
      getLocalTimeZone()
    ).toAbsoluteString();

    // @ts-expect-error
    const date = parseAbsolute(_dateString);

    return formatter.format(date.toDate());
  } catch {
    try {
      const date = new Date(dateString);
      return formatter.format(date);
    } catch {
      return dateString;
    }
  }
}

export function formatDateTime(isoString: string, locale?: string) {
  return formatDate(
    isoString,
    { dateStyle: "short", timeStyle: "short" },
    locale
  );
}

export function formatRelativeTime(isoString: string, locale?: string) {
  if (new Date(isoString).getTime() > new Date().getTime()) {
    return formatTimeFromNow(isoString, locale);
  } else {
    return formatTimeAgo(isoString, locale);
  }
}

export function formatTimeAgo(isoString: string, locale?: string) {
  const relativeFormatter = getRelativeFormatter(locale || DEFAULT_LOCALE);
  let duration = (new Date(isoString).getTime() - Date.now()) / 1000;

  const len = DIVISIONS.length;
  for (let i = 0; i < len; i++) {
    const division = DIVISIONS[i];
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }
  return "";
}

export function formatTimeFromNow(isoString: string, locale?: string) {
  const relativeFormatter = getRelativeFormatter(locale || DEFAULT_LOCALE);
  let duration = (Date.now() - new Date(isoString).getTime()) / 1000;

  const len = DIVISIONS.length;
  for (let i = 0; i < len; i++) {
    const division = DIVISIONS[i];
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(-1 * duration), division.name);
    }
    duration /= division.amount;
  }
  return "";
}

export function getDateNYearsAgo(n: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - n);
  return date;
}
