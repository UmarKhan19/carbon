export const macrsPropertyClasses = [
  "3",
  "5",
  "7",
  "10",
  "15",
  "20",
  "27.5",
  "39"
] as const;

export const macrsConventions = ["Half-Year", "Mid-Quarter"] as const;

export type MacrsPropertyClass = (typeof macrsPropertyClasses)[number];
export type MacrsConvention = (typeof macrsConventions)[number];

// IRS Revenue Procedure 87-57, Table 1 (GDS, Half-Year Convention)
const MACRS_HALF_YEAR: Record<string, number[]> = {
  "3": [33.33, 44.45, 14.81, 7.41],
  "5": [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  "7": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10": [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  "15": [
    5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9,
    5.91, 2.95
  ],
  "20": [
    3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462,
    4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231
  ]
};

// IRS Tables 2-5 (GDS, Mid-Quarter Convention)
const MACRS_MID_QUARTER: Record<string, Record<number, number[]>> = {
  "3": {
    1: [58.33, 27.78, 12.35, 1.54],
    2: [41.67, 38.89, 14.14, 5.3],
    3: [25.0, 50.0, 16.67, 8.33],
    4: [8.33, 61.11, 20.37, 10.19]
  },
  "5": {
    1: [35.0, 26.0, 15.6, 11.01, 11.01, 1.38],
    2: [25.0, 30.0, 18.0, 11.37, 11.37, 4.26],
    3: [15.0, 34.0, 20.4, 12.24, 11.3, 7.06],
    4: [5.0, 38.0, 22.8, 13.68, 10.94, 9.58]
  },
  "7": {
    1: [25.0, 21.43, 15.31, 10.93, 8.75, 8.74, 8.75, 1.09],
    2: [17.85, 23.47, 16.76, 11.97, 8.87, 8.87, 8.87, 3.34],
    3: [10.71, 25.51, 18.22, 13.02, 9.3, 8.85, 8.86, 5.53],
    4: [3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64]
  },
  "10": {
    1: [17.5, 16.5, 13.2, 10.56, 8.45, 6.76, 6.55, 6.55, 6.56, 6.55, 0.82],
    2: [12.5, 17.5, 14.0, 11.2, 8.96, 7.17, 6.55, 6.55, 6.56, 6.55, 2.46],
    3: [7.5, 18.5, 14.8, 11.84, 9.47, 7.58, 6.55, 6.55, 6.56, 6.55, 4.1],
    4: [2.5, 19.5, 15.6, 12.48, 9.98, 7.99, 6.55, 6.55, 6.56, 6.55, 5.74]
  },
  "15": {
    1: [
      8.75, 9.13, 8.21, 7.39, 6.65, 5.99, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 0.74
    ],
    2: [
      6.25, 9.38, 8.44, 7.59, 6.83, 6.15, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 2.21
    ],
    3: [
      3.75, 9.63, 8.66, 7.8, 7.02, 6.31, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 3.69
    ],
    4: [
      1.25, 9.88, 8.89, 8.0, 7.2, 6.48, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 5.17
    ]
  },
  "20": {
    1: [
      6.563, 7.0, 6.482, 5.996, 5.546, 5.13, 4.746, 4.459, 4.459, 4.459, 4.459,
      4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 0.557
    ],
    2: [
      4.688, 7.148, 6.612, 6.116, 5.658, 5.233, 4.841, 4.478, 4.463, 4.463,
      4.463, 4.463, 4.463, 4.463, 4.463, 4.462, 4.463, 4.462, 4.463, 4.462,
      1.673
    ],
    3: [
      2.813, 7.289, 6.742, 6.237, 5.769, 5.336, 4.936, 4.566, 4.46, 4.46, 4.46,
      4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 2.788
    ],
    4: [
      0.938, 7.43, 6.872, 6.357, 5.88, 5.439, 5.031, 4.654, 4.458, 4.458, 4.458,
      4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.459, 4.458, 3.901
    ]
  }
};

export function getMacrsPercentage(
  propertyClass: MacrsPropertyClass,
  yearInService: number,
  convention: MacrsConvention,
  quarterPlacedInService?: number
): number | null {
  if (propertyClass === "27.5" || propertyClass === "39") {
    return null;
  }

  const yearIndex = yearInService - 1;

  if (convention === "Half-Year") {
    const table = MACRS_HALF_YEAR[propertyClass];
    if (!table || yearIndex >= table.length) return 0;
    return table[yearIndex];
  }

  const quarter = quarterPlacedInService ?? 1;
  const classTable = MACRS_MID_QUARTER[propertyClass];
  if (!classTable) return 0;
  const table = classTable[quarter];
  if (!table || yearIndex >= table.length) return 0;
  return table[yearIndex];
}

export function calculateMacrsDepreciation(args: {
  adjustedBasis: number;
  propertyClass: MacrsPropertyClass;
  convention: MacrsConvention;
  depreciationStartDate: string;
  periodEnd: string;
  lastPostedPeriodEnd: string | null;
  accumulatedTaxDepreciation: number;
  bonusAmount: number;
}): number {
  const {
    adjustedBasis,
    propertyClass,
    convention,
    depreciationStartDate,
    periodEnd,
    lastPostedPeriodEnd,
    accumulatedTaxDepreciation,
    bonusAmount
  } = args;

  if (adjustedBasis <= 0) return 0;

  const startDate = new Date(depreciationStartDate);
  const periodEndDate = new Date(periodEnd);
  const fromDate = lastPostedPeriodEnd
    ? new Date(lastPostedPeriodEnd)
    : startDate;

  // 27.5 and 39-year property: straight-line with mid-month convention
  if (propertyClass === "27.5" || propertyClass === "39") {
    const lifeMonths = propertyClass === "27.5" ? 27.5 * 12 : 39 * 12;
    const monthlyAmount = adjustedBasis / lifeMonths;
    const monthsElapsed =
      (periodEndDate.getFullYear() - fromDate.getFullYear()) * 12 +
      (periodEndDate.getMonth() - fromDate.getMonth());
    const months = lastPostedPeriodEnd ? monthsElapsed : monthsElapsed + 0.5;
    const amount = monthlyAmount * Math.max(0, months);
    const remaining =
      adjustedBasis - (accumulatedTaxDepreciation - bonusAmount);
    return Math.min(Math.round(amount * 100) / 100, Math.max(0, remaining));
  }

  // Table-based MACRS
  const quarterPlaced = Math.ceil((startDate.getMonth() + 1) / 3);
  const startYear = startDate.getFullYear();
  const periodEndYear = periodEndDate.getFullYear();
  const fromYear = fromDate.getFullYear();

  let totalForPeriod = 0;

  const firstYearToCalc = lastPostedPeriodEnd
    ? fromYear -
      startYear +
      1 +
      (fromDate.getMonth() >= startDate.getMonth() ? 1 : 0)
    : 1;
  const lastYearToCalc = periodEndYear - startYear + 1;

  for (let year = firstYearToCalc; year <= lastYearToCalc; year++) {
    const pct = getMacrsPercentage(
      propertyClass,
      year,
      convention,
      quarterPlaced
    );
    if (pct === null || pct === 0) continue;

    const annualAmount = adjustedBasis * (pct / 100);
    const yearStart = new Date(startYear + year - 1, startDate.getMonth(), 1);
    const yearEnd = new Date(startYear + year, startDate.getMonth(), 1);

    const periodStart = fromDate > yearStart ? fromDate : yearStart;
    const periodEndCapped = periodEndDate < yearEnd ? periodEndDate : yearEnd;

    if (periodStart >= periodEndCapped) continue;

    const monthsInPeriod =
      (periodEndCapped.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEndCapped.getMonth() - periodStart.getMonth()) +
      1;

    const fraction = Math.min(1, monthsInPeriod / 12);
    totalForPeriod += annualAmount * fraction;
  }

  const remaining = adjustedBasis - (accumulatedTaxDepreciation - bonusAmount);
  return Math.min(
    Math.round(totalForPeriod * 100) / 100,
    Math.max(0, remaining)
  );
}
