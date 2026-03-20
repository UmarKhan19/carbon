import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useEffect, useState } from "react";
import { LuClock } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator
} from "react-router";
import { getCompanySettings } from "~/modules/settings";
import {
  clockIn,
  clockOut,
  getClockedInEmployees,
  getOnBreakEmployees,
  getOpenClockEntry,
  getScheduledEmployeesToday,
  getTimeClockDashboard,
  getWeeklyHoursForEmployees,
  isOnBreak
} from "~/modules/timeclock";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Time Clock",
  to: path.to.peopleTimeClock
};

function formatMs(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function getDailyTotal(
  employeeId: string,
  clockInTime: string | null,
  dailyTotals: Record<string, number>
) {
  const completedMs = dailyTotals[employeeId] ?? 0;
  const activeMs = clockInTime
    ? Date.now() - new Date(clockInTime).getTime()
    : 0;
  return formatMs(completedMs + activeMs);
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(clockInStr: string, clockOutStr: string | null) {
  const end = clockOutStr ? new Date(clockOutStr).getTime() : Date.now();
  const ms = end - new Date(clockInStr).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

type Flag = {
  label: string;
  color: "yellow" | "red";
};

function parseShiftTime(timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function computeFlags(
  clockInTime: string | null,
  shiftStartTime: string | null,
  weeklyMs: number
): Flag[] {
  const flags: Flag[] = [];

  // Overtime flags
  const weeklyHrs = weeklyMs / 3600000;
  if (weeklyHrs >= 40) {
    flags.push({ label: "OT", color: "red" });
  } else if (weeklyHrs >= 38) {
    flags.push({ label: "OT Soon", color: "yellow" });
  }

  // Late/early flags based on shift
  if (shiftStartTime && clockInTime) {
    const shiftStart = parseShiftTime(shiftStartTime);
    const clockIn = new Date(clockInTime);
    const diffMinutes = (clockIn.getTime() - shiftStart.getTime()) / 60000;

    if (diffMinutes >= 15) {
      flags.push({ label: "Late", color: "red" });
    } else if (diffMinutes <= -15) {
      flags.push({ label: "Early", color: "red" });
    }
  }

  return flags;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "people"
  });

  const companySettings = await getCompanySettings(client, companyId);
  if (!companySettings.data?.timeClockEnabled) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(
          null,
          "Time clock is not enabled. To enable this feature, go to Settings → People to Enable Time Clock."
        )
      )
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    clockedIn,
    onBreak,
    recentActivity,
    openEntry,
    todayEntries,
    scheduledToday
  ] = await Promise.all([
    getClockedInEmployees(client, companyId),
    getOnBreakEmployees(client, companyId),
    getTimeClockDashboard(client, companyId),
    getOpenClockEntry(client, userId, companyId),
    client
      .from("timeClockDashboard")
      .select("*")
      .eq("companyId", companyId)
      .gte("clockIn", todayStart.toISOString())
      .order("clockIn", { ascending: true }),
    getScheduledEmployeesToday(client, companyId)
  ]);

  // Build daily totals per employee (completed entries only)
  const dailyTotals: Record<string, number> = {};
  for (const entry of todayEntries.data ?? []) {
    if (!entry.employeeId) continue;
    if (entry.clockOut) {
      const ms =
        new Date(entry.clockOut).getTime() - new Date(entry.clockIn!).getTime();
      dailyTotals[entry.employeeId] = (dailyTotals[entry.employeeId] ?? 0) + ms;
    }
  }

  // Get weekly hours for all relevant employees
  const allEmployeeIds = [
    ...(clockedIn.data ?? []).map((e) => e.employeeId),
    ...onBreak.map((e) => e.employeeId)
  ].filter(Boolean) as string[];

  const weeklyHours =
    allEmployeeIds.length > 0
      ? await getWeeklyHoursForEmployees(client, companyId, allEmployeeIds)
      : {};

  // Determine no-shows: scheduled today but not clocked in and not on break
  const clockedInIds = new Set((clockedIn.data ?? []).map((e) => e.employeeId));
  const onBreakIds = new Set(onBreak.map((e) => e.employeeId));
  const noShows = scheduledToday.filter(
    (ej) => !clockedInIds.has(ej.id) && !onBreakIds.has(ej.id)
  );

  const userBreakStatus = await isOnBreak(client, userId, companyId);

  return {
    clockedIn: clockedIn.data ?? [],
    onBreak,
    noShows,
    recentActivity: (recentActivity.data ?? []).slice(0, 50),
    openEntry: openEntry.data,
    dailyTotals,
    weeklyHours,
    userBreakEntry:
      userBreakStatus.onBreak && userBreakStatus.breakClockOut
        ? { clockOut: userBreakStatus.breakClockOut }
        : null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "people"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Clocked in")));
  }

  if (intent === "clockOut") {
    const type = (formData.get("type") as string) || "shift_end";
    const result = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId,
      type: type as "shift_end" | "break"
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Clocked out")));
  }

  return data({}, { status: 400 });
}

export default function PeopleTimeClockRoute() {
  const {
    clockedIn,
    onBreak,
    noShows,
    recentActivity,
    openEntry,
    dailyTotals,
    weeklyHours,
    userBreakEntry
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const totalOnClock = clockedIn.length + onBreak.length;

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-8 px-4 max-w-[80rem] h-full mx-auto gap-4"
      >
        <HStack className="items-center justify-between w-full">
          <HStack className="items-center gap-2">
            <LuClock className="size-5" />
            <Heading size="h3">Time Clock</Heading>
          </HStack>
          <div>
            {openEntry ? (
              <HStack className="gap-1">
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="clockOut" />
                  <input type="hidden" name="type" value="shift_end" />
                  <Button
                    variant="destructive"
                    size="sm"
                    type="submit"
                    disabled={fetcher.state !== "idle"}
                  >
                    Clock Out
                  </Button>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="clockOut" />
                  <input type="hidden" name="type" value="break" />
                  <Button
                    variant="outline"
                    size="sm"
                    type="submit"
                    disabled={fetcher.state !== "idle"}
                    className="border-yellow-500 text-yellow-600 hover:bg-yellow-50"
                  >
                    Break
                  </Button>
                </fetcher.Form>
              </HStack>
            ) : userBreakEntry ? (
              <HStack className="gap-2 items-center">
                <Badge
                  variant="outline"
                  className="text-yellow-600 border-yellow-600 text-xs"
                >
                  On Break ·{" "}
                  {formatMs(
                    Date.now() - new Date(userBreakEntry.clockOut).getTime()
                  )}
                </Badge>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="clockIn" />
                  <Button
                    variant="outline"
                    size="sm"
                    type="submit"
                    disabled={fetcher.state !== "idle"}
                    className="border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                  >
                    Clock Back In
                  </Button>
                </fetcher.Form>
              </HStack>
            ) : (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockIn" />
                <Button
                  size="sm"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  Clock In
                </Button>
              </fetcher.Form>
            )}
          </div>
        </HStack>

        {/* Employee Status Table */}
        <Card>
          <CardHeader>
            <CardTitle>Employee Status</CardTitle>
            <CardDescription>
              {totalOnClock} employee{totalOnClock !== 1 ? "s" : ""} on the
              clock
              {noShows.length > 0 &&
                ` · ${noShows.length} no-show${noShows.length !== 1 ? "s" : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableBase>
              <Thead>
                <Tr>
                  <Th>Employee</Th>
                  <Th>Status</Th>
                  <Th>Clock In</Th>
                  <Th>Daily Total</Th>
                  <Th>Shift</Th>
                  <Th className="text-center">Status Alerts</Th>
                </Tr>
              </Thead>
              <Tbody>
                {totalOnClock === 0 && noShows.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      No employee activity today
                    </Td>
                  </Tr>
                ) : (
                  <>
                    {/* Active employees */}
                    {clockedIn.map((entry) => {
                      const flags = computeFlags(
                        entry.clockIn,
                        entry.shiftStartTime ?? null,
                        weeklyHours[entry.employeeId!] ?? 0
                      );
                      return (
                        <Tr key={entry.id}>
                          <Td>
                            <a
                              href={path.to.personTimeClock(entry.employeeId!)}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <Avatar
                                className="size-6"
                                src={entry.avatarUrl ?? undefined}
                                name={`${entry.firstName ?? ""} ${entry.lastName ?? ""}`}
                              />
                              <span className="text-sm">
                                {entry.firstName} {entry.lastName}
                              </span>
                            </a>
                          </Td>
                          <Td>
                            <Badge
                              variant="outline"
                              className="text-emerald-600 border-emerald-600"
                            >
                              Active
                            </Badge>
                          </Td>
                          <Td>{formatTime(entry.clockIn!)}</Td>
                          <Td>
                            {getDailyTotal(
                              entry.employeeId!,
                              entry.clockIn,
                              dailyTotals
                            )}
                          </Td>
                          <Td className="text-sm text-muted-foreground">
                            {entry.shiftName ?? "—"}
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1 items-center pt-1">
                              {flags.map((flag) => (
                                <Badge
                                  key={flag.label}
                                  variant="outline"
                                  className={
                                    flag.color === "red"
                                      ? "text-red-600 border-red-600"
                                      : "text-yellow-600 border-yellow-600"
                                  }
                                >
                                  {flag.label}
                                </Badge>
                              ))}
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}

                    {/* On break employees */}
                    {onBreak.map((entry) => (
                      <Tr key={`break-${entry.employeeId}`}>
                        <Td>
                          <a
                            href={path.to.personTimeClock(entry.employeeId!)}
                            className="flex items-center gap-2 hover:underline"
                          >
                            <Avatar
                              className="size-6"
                              src={entry.avatarUrl ?? undefined}
                              name={`${entry.firstName ?? ""} ${entry.lastName ?? ""}`}
                            />
                            <span className="text-sm">
                              {entry.firstName} {entry.lastName}
                            </span>
                          </a>
                        </Td>
                        <Td>
                          <Badge
                            variant="outline"
                            className="text-yellow-600 border-yellow-600"
                          >
                            Break
                          </Badge>
                        </Td>
                        <Td className="text-muted-foreground">—</Td>
                        <Td>
                          {getDailyTotal(entry.employeeId!, null, dailyTotals)}
                        </Td>
                        <Td className="text-sm text-muted-foreground">
                          {entry.shiftName ?? "—"}
                        </Td>
                        <Td />
                      </Tr>
                    ))}

                    {/* No-show employees */}
                    {noShows.map((ej) => {
                      const shift = ej.shift as Record<string, unknown> | null;
                      return (
                        <Tr key={`noshow-${ej.id}`}>
                          <Td>
                            <a
                              href={path.to.personTimeClock(ej.id)}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <span className="text-sm">{ej.id}</span>
                            </a>
                          </Td>
                          <Td>
                            <Badge
                              variant="outline"
                              className="text-red-600 border-red-600"
                            >
                              No Show
                            </Badge>
                          </Td>
                          <Td className="text-muted-foreground">—</Td>
                          <Td className="text-muted-foreground">—</Td>
                          <Td className="text-sm text-muted-foreground">
                            {(shift?.name as string) ?? "—"}
                          </Td>
                          <Td />
                        </Tr>
                      );
                    })}
                  </>
                )}
              </Tbody>
            </TableBase>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Latest time clock entries across all employees
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableBase>
              <Thead>
                <Tr>
                  <Th>Employee</Th>
                  <Th>Date</Th>
                  <Th>Clock In</Th>
                  <Th>Clock Out</Th>
                  <Th>Duration</Th>
                </Tr>
              </Thead>
              <Tbody>
                {recentActivity.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No time clock entries yet
                    </Td>
                  </Tr>
                ) : (
                  recentActivity.map((entry) => (
                    <Tr key={entry.id}>
                      <Td>
                        <a
                          href={path.to.personTimeClock(entry.employeeId!)}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <Avatar
                            className="size-6"
                            src={entry.avatarUrl ?? undefined}
                            name={`${entry.firstName ?? ""} ${entry.lastName ?? ""}`}
                          />
                          <span className="text-sm">
                            {entry.firstName} {entry.lastName}
                          </span>
                        </a>
                      </Td>
                      <Td>
                        {formatDate(entry.clockIn!, { dateStyle: "medium" })}
                      </Td>
                      <Td>{formatTime(entry.clockIn!)}</Td>
                      <Td>
                        {entry.clockOut ? (
                          formatTime(entry.clockOut)
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-emerald-600 border-emerald-600"
                          >
                            Active
                          </Badge>
                        )}
                      </Td>
                      <Td>{formatDuration(entry.clockIn!, entry.clockOut)}</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableBase>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
