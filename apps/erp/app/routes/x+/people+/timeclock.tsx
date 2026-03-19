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
  getOpenClockEntry,
  getTimeClockDashboard
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

/** Daily total = completed entries + current active session */
function getDailyTotal(
  employeeId: string,
  clockIn: string,
  dailyTotals: Record<string, number>
) {
  const completedMs = dailyTotals[employeeId] ?? 0;
  const activeMs = Date.now() - new Date(clockIn).getTime();
  return formatMs(completedMs + activeMs);
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(clockIn: string, clockOut: string | null) {
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const ms = end - new Date(clockIn).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
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

  // Get start of today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [clockedIn, recentActivity, openEntry, todayEntries] =
    await Promise.all([
      getClockedInEmployees(client, companyId),
      getTimeClockDashboard(client, companyId),
      getOpenClockEntry(client, userId, companyId),
      client
        .from("timeClockDashboard")
        .select("*")
        .eq("companyId", companyId)
        .gte("clockIn", todayStart.toISOString())
        .order("clockIn", { ascending: true })
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

  return {
    clockedIn: clockedIn.data ?? [],
    recentActivity: (recentActivity.data ?? []).slice(0, 50),
    openEntry: openEntry.data,
    dailyTotals
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
    const result = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId
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
  const { clockedIn, recentActivity, openEntry, dailyTotals } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const [, setTick] = useState(0);

  // Refresh elapsed times every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Revalidate data every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [revalidator]);

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
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockOut" />
                <Button
                  variant="destructive"
                  size="sm"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  Clock Out
                </Button>
              </fetcher.Form>
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

        <Card>
          <CardHeader>
            <CardTitle>Currently Clocked In</CardTitle>
            <CardDescription>
              {clockedIn.length} employee{clockedIn.length !== 1 ? "s" : ""}{" "}
              currently on the clock
            </CardDescription>
          </CardHeader>
          <CardContent>
            {clockedIn.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No employees currently clocked in
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {clockedIn.map((entry) => (
                  <a
                    key={entry.id}
                    href={path.to.personTimeClock(entry.employeeId!)}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <Avatar
                      className="size-10"
                      src={entry.avatarUrl ?? undefined}
                      name={`${entry.firstName ?? ""} ${entry.lastName ?? ""}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.firstName} {entry.lastName}
                      </p>
                      {entry.jobTitle && (
                        <p className="text-xs text-muted-foreground truncate">
                          {entry.jobTitle}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge
                        variant="outline"
                        className="text-emerald-600 border-emerald-600"
                      >
                        {getDailyTotal(
                          entry.employeeId!,
                          entry.clockIn!,
                          dailyTotals
                        )}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        today
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
