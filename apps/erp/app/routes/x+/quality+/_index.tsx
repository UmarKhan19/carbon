import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateRangePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { today } from "@internationalized/date";
import type { DateRange } from "@react-types/datepicker";
import { Suspense, useMemo, useState } from "react";
import {
  LuArrowUpRight,
  LuChevronDown,
  LuClock,
  LuInbox,
  LuListChecks,
  LuShieldAlert,
  LuShieldCheck,
  LuShieldX
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Await, Link, useLoaderData } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { Empty, Hyperlink } from "~/components";
import { GradientBar } from "~/components/GradientBar";
import {
  getIssueTypesList,
  getQualityDashboardActionTasks,
  getQualityDashboardIssues
} from "~/modules/quality";
import IssueStatus from "~/modules/quality/ui/Issue/IssueStatus";
import { chartIntervals } from "~/modules/shared/shared.models";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Dashboard",
  to: path.to.quality
};

const OPEN_ISSUE_STATUSES = ["Registered", "In Progress"] as const;
const OPEN_ACTION_STATUSES = ["Pending", "In Progress"] as const;

const QualityCharts = [
  { key: "weeklyTracking", label: "Issue Trend" },
  { key: "ncrStatus", label: "NCR Status" },
  { key: "statusByCriticality", label: "Status by Criticality" },
  { key: "containmentProgress", label: "Containment Progress" },
  { key: "weeksOpen", label: "Weeks Open" },
  { key: "ncrsByTypeCriticality", label: "NCRs by Type (Criticality)" },
  { key: "ncrsByTypeProgress", label: "NCRs by Type (Progress)" }
] as const;

const qualityChartConfig = {
  Critical: { label: "Critical", color: "hsl(var(--destructive))" },
  High: { label: "High", color: "hsl(var(--chart-1))" },
  Medium: { label: "Medium", color: "hsl(var(--chart-4))" },
  Low: { label: "Low", color: "hsl(var(--success))" },
  Registered: { label: "Registered", color: "hsl(var(--chart-1))" },
  "In Progress": { label: "In Progress", color: "hsl(var(--primary))" },
  Closed: { label: "Closed", color: "hsl(var(--chart-2))" },
  opened: { label: "Opened", color: "hsl(var(--primary))" },
  closed: { label: "Closed", color: "hsl(var(--chart-2))" },
  runningTotal: { label: "Running Total", color: "hsl(var(--chart-1))" },
  count: { label: "Count" },
  "0-4 weeks": { label: "0-4 weeks", color: "hsl(var(--success))" },
  "5-8 weeks": { label: "5-8 weeks", color: "hsl(var(--chart-4))" },
  "9-12 weeks": { label: "9-12 weeks", color: "hsl(var(--chart-1))" },
  "13+ weeks": { label: "13+ weeks", color: "hsl(var(--destructive))" }
} satisfies ChartConfig;

const weeklyLegendPayload = [
  {
    value: "Opened",
    type: "square" as const,
    color: qualityChartConfig.opened.color
  },
  {
    value: "Closed",
    type: "square" as const,
    color: qualityChartConfig.closed.color
  },
  {
    value: "Running Total",
    type: "line" as const,
    color: qualityChartConfig.runningTotal.color
  },
  {
    value: "Target",
    type: "line" as const,
    color: "hsl(var(--destructive))"
  }
];

function formatWeekLabel(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekKey;
  const year = Number.parseInt(match[1]);
  const week = Number.parseInt(match[2]);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const [issues, actionTasks, issueTypes] = await Promise.all([
    getQualityDashboardIssues(client, companyId),
    getQualityDashboardActionTasks(client, companyId),
    getIssueTypesList(client, companyId)
  ]);

  const assignedToMe = client
    .from("issues")
    .select("id, nonConformanceId, name, status, priority")
    .eq("companyId", companyId)
    .eq("assignee", userId)
    .in("status", OPEN_ISSUE_STATUSES)
    .order("createdAt", { ascending: false })
    .limit(10)
    .then((result) => result.data ?? []);

  return {
    issues: issues.data ?? [],
    actionTasks: actionTasks.data ?? [],
    issueTypes: issueTypes.data ?? [],
    assignedToMe
  };
}

// --- ISO Week Helpers ---

function getISOWeekYear(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

function formatWeekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekKeyFromDate(dateStr: string): string {
  const { year, week } = getISOWeekYear(new Date(dateStr));
  return formatWeekKey(year, week);
}

function generateWeekKeys(startDate: Date, endDate: Date): string[] {
  const keys: string[] = [];
  const current = new Date(startDate);
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7));

  while (current <= endDate) {
    const { year, week } = getISOWeekYear(current);
    keys.push(formatWeekKey(year, week));
    current.setDate(current.getDate() + 7);
  }
  return keys;
}

// --- Priority Helpers ---

const priorityOrder = ["Critical", "High", "Medium", "Low"] as const;
const statusOrder = ["Closed", "In Progress", "Registered"] as const;

function getPriorityVariant(priority: string | null) {
  switch (priority) {
    case "Critical":
      return "red";
    case "High":
      return "orange";
    case "Medium":
      return "yellow";
    case "Low":
      return "green";
    default:
      return "gray";
  }
}

// --- Component ---

export default function QualityDashboard() {
  const { issues, actionTasks, issueTypes, assignedToMe } =
    useLoaderData<typeof loader>();
  const [selectedChart, setSelectedChart] = useState("weeklyTracking");
  const [interval, setInterval] = useState("year");
  const [target, setTarget] = useState(20);
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const end = today("UTC");
    const start = end.add({ years: -1 });
    return { start, end };
  });

  const selectedChartData =
    QualityCharts.find((c) => c.key === selectedChart) || QualityCharts[0];
  const selectedInterval =
    chartIntervals.find((i) => i.key === interval) || chartIntervals[3];

  const onIntervalChange = (value: string) => {
    const end = today("UTC");
    if (value === "week") {
      setDateRange({ start: end.add({ days: -7 }), end });
    } else if (value === "month") {
      setDateRange({ start: end.add({ months: -1 }), end });
    } else if (value === "quarter") {
      setDateRange({ start: end.add({ months: -3 }), end });
    } else if (value === "year") {
      setDateRange({ start: end.add({ years: -1 }), end });
    }
    setInterval(value);
  };

  // Build containment map: nonConformanceId -> containment task info
  const containmentMap = useMemo(() => {
    const map = new Map<string, { status: string; assignee: string | null }>();
    for (const task of actionTasks) {
      if (task.actionName === "Containment Action") {
        map.set(task.nonConformanceId, {
          status: task.status,
          assignee: task.assignee
        });
      }
    }
    return map;
  }, [actionTasks]);

  // Issue type lookup
  const typeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of issueTypes) {
      map.set(t.id, t.name);
    }
    return map;
  }, [issueTypes]);

  // --- KPI Counts ---
  const openIssuesCount = useMemo(() => {
    return issues.filter((i) => i.status !== "Closed").length;
  }, [issues]);

  const openActionsCount = useMemo(() => {
    return actionTasks.filter(
      (t) => t.status === "Pending" || t.status === "In Progress"
    ).length;
  }, [actionTasks]);

  // --- KPI: Uncontained + On the Line ---
  const { uncontainedCount, containedCount } = useMemo(() => {
    let uncontained = 0;
    let contained = 0;

    for (const issue of issues) {
      if (issue.status === "Closed") continue;

      const containment = containmentMap.get(issue.id);
      if (!containment || containment.status === "Pending") {
        uncontained++;
      } else if (containment.status === "In Progress") {
        contained++;
      }
    }

    return {
      uncontainedCount: uncontained,
      containedCount: contained
    };
  }, [issues, containmentMap]);

  // --- Recently Created ---
  const recentlyCreated = useMemo(() => {
    return [...issues]
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 10);
  }, [issues]);

  // --- Filtered Issues (for chart date range) ---
  const filteredIssues = useMemo(() => {
    if (!dateRange?.start || !dateRange?.end) return issues;
    const start = dateRange.start.toString();
    const end = dateRange.end.toString();
    return issues.filter((issue) => {
      const date = (issue.createdAt ?? issue.openDate ?? "").slice(0, 10);
      if (!date) return true;
      return date >= start && date <= end;
    });
  }, [issues, dateRange]);

  // --- Weekly Tracking ---
  const weeklyData = useMemo(() => {
    const endDate = dateRange?.end
      ? new Date(dateRange.end.toString())
      : new Date();
    const startDate = dateRange?.start
      ? new Date(dateRange.start.toString())
      : (() => {
          const d = new Date(endDate);
          d.setDate(d.getDate() - 52 * 7);
          return d;
        })();

    const allWeekKeys = generateWeekKeys(startDate, endDate);
    const weekMap = new Map<string, { opened: number; closed: number }>();
    for (const key of allWeekKeys) {
      weekMap.set(key, { opened: 0, closed: 0 });
    }

    let baseline = 0;
    const startKey = allWeekKeys[0];

    for (const issue of issues) {
      if (!issue.openDate) continue;
      const openKey = weekKeyFromDate(issue.openDate);

      if (openKey < startKey) {
        if (!issue.closeDate || weekKeyFromDate(issue.closeDate) >= startKey) {
          baseline++;
        }
      } else if (weekMap.has(openKey)) {
        const entry = weekMap.get(openKey)!;
        entry.opened++;
      }

      if (issue.closeDate) {
        const closeKey = weekKeyFromDate(issue.closeDate);
        if (closeKey < startKey) {
          // Closed before the window — already accounted for
        } else if (weekMap.has(closeKey)) {
          const entry = weekMap.get(closeKey)!;
          entry.closed++;
        }
      }
    }

    let running = baseline;
    return allWeekKeys.map((week) => {
      const entry = weekMap.get(week)!;
      running += entry.opened - entry.closed;
      return {
        week,
        opened: entry.opened,
        closed: entry.closed,
        runningTotal: running
      };
    });
  }, [issues, dateRange]);

  const weeklyStats = useMemo(() => {
    const currentTotal =
      weeklyData.length > 0
        ? weeklyData[weeklyData.length - 1].runningTotal
        : 0;
    const totalOpened = weeklyData.reduce((sum, d) => sum + d.opened, 0);
    const totalClosed = weeklyData.reduce((sum, d) => sum + d.closed, 0);
    return { currentOpen: currentTotal, totalOpened, totalClosed };
  }, [weeklyData]);

  // --- NCR Status ---
  const ncrStatusData = useMemo(() => {
    const counts: Record<string, number> = {
      Closed: 0,
      "In Progress": 0,
      Registered: 0
    };
    for (const issue of filteredIssues) {
      if (counts[issue.status] !== undefined) {
        counts[issue.status]++;
      }
    }
    return [
      {
        status: "Closed",
        count: counts.Closed,
        fill: "hsl(var(--chart-2))"
      },
      {
        status: "In Progress",
        count: counts["In Progress"],
        fill: "hsl(var(--primary))"
      },
      {
        status: "Registered",
        count: counts.Registered,
        fill: "hsl(var(--chart-1))"
      }
    ];
  }, [filteredIssues]);

  // --- Status by Criticality ---
  const statusByCriticalityData = useMemo(() => {
    const grid: Record<string, Record<string, number>> = {};
    for (const status of statusOrder) {
      grid[status] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    }
    for (const issue of filteredIssues) {
      if (grid[issue.status] && issue.priority) {
        grid[issue.status][issue.priority]++;
      }
    }
    return statusOrder.map((status) => ({
      status,
      ...grid[status]
    }));
  }, [filteredIssues]);

  // --- Containment Progress by Criticality ---
  const containmentProgressData = useMemo(() => {
    const grid: Record<string, Record<string, number>> = {
      "In Progress": { Critical: 0, High: 0, Medium: 0, Low: 0 },
      Pending: { Critical: 0, High: 0, Medium: 0, Low: 0 }
    };

    for (const issue of filteredIssues) {
      if (issue.status === "Closed") continue;
      const containment = containmentMap.get(issue.id);
      const cStatus =
        !containment || containment.status === "Pending"
          ? "Pending"
          : containment.status === "In Progress"
            ? "In Progress"
            : null;

      if (cStatus && issue.priority && grid[cStatus]) {
        grid[cStatus][issue.priority]++;
      }
    }

    return ["In Progress", "Pending"].map((status) => ({
      status,
      ...grid[status]
    }));
  }, [filteredIssues, containmentMap]);

  // --- Weeks Open by Criticality ---
  const weeksOpenData = useMemo(() => {
    const now = Date.now();
    const grid: Record<string, Record<string, number>> = {};
    for (const p of priorityOrder) {
      grid[p] = {
        "0-4 weeks": 0,
        "5-8 weeks": 0,
        "9-12 weeks": 0,
        "13+ weeks": 0
      };
    }

    for (const issue of filteredIssues) {
      if (issue.status === "Closed" || !issue.openDate || !issue.priority)
        continue;
      const weeksOpen = Math.floor(
        (now - new Date(issue.openDate).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      let bucket: string;
      if (weeksOpen <= 4) bucket = "0-4 weeks";
      else if (weeksOpen <= 8) bucket = "5-8 weeks";
      else if (weeksOpen <= 12) bucket = "9-12 weeks";
      else bucket = "13+ weeks";

      if (grid[issue.priority]) {
        grid[issue.priority][bucket]++;
      }
    }

    return priorityOrder.map((criticality) => ({
      criticality,
      ...grid[criticality]
    }));
  }, [filteredIssues]);

  // --- NCRs by Type and Criticality ---
  const ncrsByTypeCriticalityData = useMemo(() => {
    const grid: Record<string, Record<string, number>> = {};
    for (const issue of filteredIssues) {
      const typeName =
        typeNameMap.get(issue.nonConformanceTypeId ?? "") ?? "Unknown";
      if (!grid[typeName]) {
        grid[typeName] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
      }
      if (issue.priority) {
        grid[typeName][issue.priority]++;
      }
    }
    return Object.entries(grid)
      .map(([type, counts]) => ({ type, ...counts }))
      .sort((a, b) => {
        const totalA =
          (a.Critical ?? 0) + (a.High ?? 0) + (a.Medium ?? 0) + (a.Low ?? 0);
        const totalB =
          (b.Critical ?? 0) + (b.High ?? 0) + (b.Medium ?? 0) + (b.Low ?? 0);
        return totalB - totalA;
      });
  }, [filteredIssues, typeNameMap]);

  // --- NCRs by Type and Progress ---
  const ncrsByTypeProgressData = useMemo(() => {
    const grid: Record<string, Record<string, number>> = {};
    for (const issue of filteredIssues) {
      const typeName =
        typeNameMap.get(issue.nonConformanceTypeId ?? "") ?? "Unknown";
      if (!grid[typeName]) {
        grid[typeName] = { Registered: 0, "In Progress": 0, Closed: 0 };
      }
      grid[typeName][issue.status]++;
    }
    return Object.entries(grid)
      .map(([type, counts]) => ({ type, ...counts }))
      .sort((a, b) => {
        const totalA =
          (a.Registered ?? 0) + (a["In Progress"] ?? 0) + (a.Closed ?? 0);
        const totalB =
          (b.Registered ?? 0) + (b["In Progress"] ?? 0) + (b.Closed ?? 0);
        return totalB - totalA;
      });
  }, [filteredIssues, typeNameMap]);

  return (
    <div className="flex flex-col gap-4 w-full p-4 h-[calc(100dvh-var(--header-height))] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-muted-foreground">
      {/* KPI Cards */}
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuShieldX className="text-muted-foreground" />
            <CardTitle>Open Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openIssuesCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.issues}?filter=status:in:${OPEN_ISSUE_STATUSES.join(",")}`}
                >
                  View Open Issues
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuShieldAlert className="text-muted-foreground" />
            <CardTitle>Uncontained Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {uncontainedCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.issues}?filter=containmentStatus:eq:Uncontained`}
                >
                  View Uncontained
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuShieldCheck className="text-muted-foreground" />
            <CardTitle>Contained Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {containedCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.issues}?filter=containmentStatus:eq:Contained`}
                >
                  View Contained
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuListChecks className="text-muted-foreground" />
            <CardTitle>Open Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between w-full items-center">
              <h3 className="text-5xl font-medium tracking-tighter">
                {openActionsCount}
              </h3>
              <Button
                rightIcon={<LuArrowUpRight />}
                variant="secondary"
                asChild
              >
                <Link
                  to={`${path.to.qualityActions}?filter=status:in:${OPEN_ACTION_STATUSES.join(",")}`}
                >
                  View Open Actions
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>
      </div>

      {/* Unified Chart Card */}
      <Card>
        <HStack className="justify-between items-center">
          <CardHeader>
            <div className="flex w-full justify-start items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>{selectedChartData.label}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={selectedChart}
                    onValueChange={setSelectedChart}
                  >
                    {QualityCharts.map((chart) => (
                      <DropdownMenuRadioItem key={chart.key} value={chart.key}>
                        {chart.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    className="hover:bg-background/80"
                  >
                    <span>
                      {selectedInterval.key === "custom"
                        ? selectedInterval.label
                        : `Last ${selectedInterval.label}`}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start">
                  <DropdownMenuRadioGroup
                    value={interval}
                    onValueChange={onIntervalChange}
                  >
                    {chartIntervals.map((i) => (
                      <DropdownMenuRadioItem key={i.key} value={i.key}>
                        {i.key === "custom" ? i.label : `Last ${i.label}`}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {interval === "custom" && (
                <DateRangePicker
                  size="sm"
                  value={dateRange}
                  onChange={setDateRange}
                />
              )}
            </div>
          </CardHeader>
          {selectedChart === "weeklyTracking" && (
            <div className="flex items-center gap-1 pr-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Target:
              </span>
              <NumberField
                value={target}
                onChange={(v) => setTarget(v)}
                minValue={0}
                aria-label="Target"
              >
                <NumberInput size="sm" className="w-16" />
              </NumberField>
            </div>
          )}
        </HStack>
        <CardContent className="flex-col gap-4">
          {selectedChart === "weeklyTracking" && (
            <HStack className="gap-8 mb-4">
              <VStack spacing={0}>
                <span className="text-xs text-muted-foreground">
                  Currently Open
                </span>
                <span className="text-2xl font-semibold tracking-tight">
                  {weeklyStats.currentOpen}
                </span>
              </VStack>
              <div className="w-px h-8 bg-border" />
              <VStack spacing={0}>
                <span className="text-xs text-muted-foreground">Opened</span>
                <span className="text-2xl font-semibold tracking-tight text-blue-500">
                  {weeklyStats.totalOpened}
                </span>
              </VStack>
              <div className="w-px h-8 bg-border" />
              <VStack spacing={0}>
                <span className="text-xs text-muted-foreground">Closed</span>
                <span className="text-2xl font-semibold tracking-tight text-green-500">
                  {weeklyStats.totalClosed}
                </span>
              </VStack>
            </HStack>
          )}

          <div className="h-[30dvw] md:h-[23dvw] min-h-[300px]">
            {selectedChart === "weeklyTracking" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <ComposedChart data={weeklyData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="week"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatWeekLabel}
                    minTickGap={32}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent labelFormatter={formatWeekLabel} />
                    }
                  />
                  <Legend payload={weeklyLegendPayload} />
                  {target > 0 && (
                    <ReferenceLine
                      y={target}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="3 3"
                      label={{
                        value: "Target",
                        position: "insideTopLeft",
                        fill: "hsl(var(--destructive))",
                        fontSize: 12
                      }}
                    />
                  )}
                  <Bar
                    dataKey="opened"
                    fill="var(--color-opened)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="closed"
                    fill="var(--color-closed)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="runningTotal"
                    stroke="var(--color-runningTotal)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            )}

            {selectedChart === "ncrStatus" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={ncrStatusData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "statusByCriticality" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={statusByCriticalityData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="Critical"
                    fill="var(--color-Critical)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="High"
                    fill="var(--color-High)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Medium"
                    fill="var(--color-Medium)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Low"
                    fill="var(--color-Low)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "containmentProgress" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={containmentProgressData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="Critical"
                    fill="var(--color-Critical)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="High"
                    fill="var(--color-High)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Medium"
                    fill="var(--color-Medium)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Low"
                    fill="var(--color-Low)"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "weeksOpen" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={weeksOpenData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="criticality"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend verticalAlign="bottom" />
                  <Bar
                    dataKey="0-4 weeks"
                    fill="hsl(var(--success))"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="5-8 weeks"
                    fill="hsl(var(--chart-4))"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="9-12 weeks"
                    fill="hsl(var(--chart-1))"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="13+ weeks"
                    fill="hsl(var(--destructive))"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "ncrsByTypeCriticality" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={ncrsByTypeCriticalityData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend verticalAlign="bottom" />
                  <Bar
                    dataKey="Critical"
                    fill="var(--color-Critical)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="High"
                    fill="var(--color-High)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Medium"
                    fill="var(--color-Medium)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Low"
                    fill="var(--color-Low)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}

            {selectedChart === "ncrsByTypeProgress" && (
              <ChartContainer
                config={qualityChartConfig}
                className="w-full h-full"
              >
                <BarChart data={ncrsByTypeProgressData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend verticalAlign="bottom" />
                  <Bar
                    dataKey="Registered"
                    fill="var(--color-Registered)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="In Progress"
                    fill="hsl(var(--primary))"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="Closed"
                    fill="var(--color-Closed)"
                    stackId="stack"
                    maxBarSize={48}
                    shape={GradientBar}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recently Created + Assigned to Me */}
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row gap-2">
            <LuClock className="text-muted-foreground" />
            <CardTitle>Recently Created</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="min-h-[200px] max-h-[360px] w-full overflow-y-auto">
              {recentlyCreated.length > 0 ? (
                <IssueTable data={recentlyCreated} />
              ) : (
                <div className="flex justify-center items-center h-full">
                  <Empty />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row gap-2">
            <LuInbox className="text-muted-foreground" />
            <CardTitle>Assigned to Me</CardTitle>
          </CardHeader>
          <CardContent className="min-h-[200px]">
            <Suspense
              fallback={
                <div className="p-4 text-muted-foreground">Loading...</div>
              }
            >
              <Await
                resolve={assignedToMe}
                errorElement={<div>Error loading assigned issues</div>}
              >
                {(assignedIssues) =>
                  assignedIssues.length > 0 ? (
                    <IssueTable data={assignedIssues} />
                  ) : (
                    <div className="flex justify-center items-center h-full">
                      <Empty />
                    </div>
                  )
                }
              </Await>
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Issue Table ---

function IssueTable({
  data
}: {
  data: {
    id: string;
    nonConformanceId: string | null;
    status: string;
    priority: string | null;
  }[];
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Issue</Th>
          <Th>Status</Th>
          <Th>Priority</Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.map((issue) => (
          <Tr key={issue.id}>
            <Td>
              <Hyperlink to={path.to.issue(issue.id)}>
                <HStack spacing={1}>
                  <LuShieldX className="size-4" />
                  <span>{issue.nonConformanceId}</span>
                </HStack>
              </Hyperlink>
            </Td>
            <Td>
              <IssueStatus
                status={
                  issue.status as "Registered" | "In Progress" | "Closed" | null
                }
              />
            </Td>
            <Td>
              {issue.priority && (
                <Badge
                  variant={
                    getPriorityVariant(issue.priority) as
                      | "red"
                      | "orange"
                      | "yellow"
                      | "green"
                      | "gray"
                  }
                >
                  {issue.priority}
                </Badge>
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
