import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  HStack,
  Input,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  clockIn,
  clockOut,
  getOpenClockEntry,
  updateTimeCardEntry
} from "~/services/people.service";
import { path } from "~/utils/path";

function getWeekBounds(offset: number = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    from: monday.toISOString(),
    to: sunday.toISOString(),
    monday,
    sunday
  };
}

function formatDuration(clockInStr: string, clockOutStr: string | null) {
  const end = clockOutStr ? new Date(clockOutStr).getTime() : Date.now();
  const ms = end - new Date(clockInStr).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTotalHours(
  entries: { clockIn: string; clockOut: string | null }[]
) {
  let totalMs = 0;
  for (const entry of entries) {
    const end = entry.clockOut
      ? new Date(entry.clockOut).getTime()
      : Date.now();
    totalMs += end - new Date(entry.clockIn).getTime();
  }
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDay(dateStr: string) {
  return new Date(dateStr).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatDateRange(from: Date, to: Date) {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric"
  };
  return `${from.toLocaleDateString([], opts)} — ${to.toLocaleDateString([], opts)}`;
}

function toLocalDatetimeInput(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

  const [entries, openEntry] = await Promise.all([
    client
      .from("timeCardEntry")
      .select("*")
      .eq("employeeId", userId)
      .eq("companyId", companyId)
      .gte("clockIn", from)
      .lte("clockIn", to)
      .order("clockIn", { ascending: false }),
    getOpenClockEntry(client, userId, companyId)
  ]);

  return {
    entries: entries.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    from,
    to
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "clockOut") {
    const result = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "updateEntry") {
    const entryId = formData.get("entryId") as string;
    const clockInVal = formData.get("clockIn") as string;
    const clockOutVal = formData.get("clockOut") as string | null;
    const result = await updateTimeCardEntry(client, {
      entryId,
      clockIn: clockInVal,
      clockOut: clockOutVal || null,
      updatedBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "deleteEntry") {
    const entryId = formData.get("entryId") as string;
    const result = await client
      .from("timeCardEntry")
      .delete()
      .eq("id", entryId);
    return { success: !result.error, error: result.error?.message };
  }

  return { success: false, error: "Unknown intent" };
}

export default function MESTimecardPage() {
  const { entries, openEntry, weekOffset, from, to } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [, setTick] = useState(0);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setEditingId(null);
    }
  }, [fetcher.data, fetcher.state]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDatetimeInput(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDatetimeInput(entry.clockOut) : "");
  }

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6">
      <VStack spacing={4} className="max-w-[60rem] mx-auto w-full gap-4">
        {/* Header with clock in/out */}
        <HStack className="justify-between items-center w-full">
          <h2 className="text-xl font-semibold">My Hours</h2>
          <div>
            {openEntry ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockOut" />
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  Clock Out
                </Button>
              </fetcher.Form>
            ) : (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockIn" />
                <Button type="submit" disabled={fetcher.state !== "idle"}>
                  Clock In
                </Button>
              </fetcher.Form>
            )}
          </div>
        </HStack>

        {openEntry && (
          <Badge variant="green" className="w-fit">
            Clocked in since {formatTime(openEntry.clockIn)}
          </Badge>
        )}

        {/* Week navigation */}
        <Card>
          <CardHeader>
            <HStack className="justify-between items-center">
              <Button variant="ghost" asChild>
                <a href={`${path.to.timeCardPage}?week=${weekOffset - 1}`}>
                  <LuChevronLeft className="size-4" />
                  Prev
                </a>
              </Button>
              <span className="text-sm text-muted-foreground">
                {formatDateRange(monday, sunday)}
              </span>
              <Button
                variant="ghost"
                disabled={isCurrentWeek}
                asChild={!isCurrentWeek}
              >
                {isCurrentWeek ? (
                  <span>
                    Next
                    <LuChevronRight className="size-4" />
                  </span>
                ) : (
                  <a href={`${path.to.timeCardPage}?week=${weekOffset + 1}`}>
                    Next
                    <LuChevronRight className="size-4" />
                  </a>
                )}
              </Button>
            </HStack>
          </CardHeader>
          <CardContent>
            <TableBase className="table-fixed w-full">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[30%]" />
                <col className="w-[30%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
              </colgroup>
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th>Clock In</Th>
                  <Th>Clock Out</Th>
                  <Th className="text-center">Duration</Th>
                  <Th className="text-center">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {entries.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No time entries for this week
                    </Td>
                  </Tr>
                ) : (
                  entries.map((entry) =>
                    editingId === entry.id ? (
                      <Tr key={entry.id}>
                        <Td className="whitespace-nowrap">
                          {formatDay(entry.clockIn)}
                        </Td>
                        <Td>
                          <Input
                            type="datetime-local"
                            value={editClockIn}
                            onChange={(e) => setEditClockIn(e.target.value)}
                            className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                        </Td>
                        <Td>
                          <Input
                            type="datetime-local"
                            value={editClockOut}
                            onChange={(e) => setEditClockOut(e.target.value)}
                            className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                        </Td>
                        <Td className="text-muted-foreground text-center">—</Td>
                        <Td className="text-center">
                          <div className="flex flex-col gap-1 items-center">
                            <fetcher.Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="updateEntry"
                              />
                              <input
                                type="hidden"
                                name="entryId"
                                value={entry.id}
                              />
                              <input
                                type="hidden"
                                name="clockIn"
                                value={
                                  isNaN(new Date(editClockIn).getTime())
                                    ? ""
                                    : new Date(editClockIn).toISOString()
                                }
                              />
                              {editClockOut &&
                                !isNaN(new Date(editClockOut).getTime()) && (
                                  <input
                                    type="hidden"
                                    name="clockOut"
                                    value={new Date(editClockOut).toISOString()}
                                  />
                                )}
                              <Button
                                variant="ghost"
                                type="submit"
                                disabled={isNaN(
                                  new Date(editClockIn).getTime()
                                )}
                              >
                                Save
                              </Button>
                            </fetcher.Form>
                            <Button
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    ) : (
                      <Tr key={entry.id}>
                        <Td className="whitespace-nowrap">
                          {formatDay(entry.clockIn)}
                        </Td>
                        <Td>{formatTime(entry.clockIn)}</Td>
                        <Td>
                          {entry.clockOut ? (
                            formatTime(entry.clockOut)
                          ) : (
                            <Badge variant="green">Active</Badge>
                          )}
                        </Td>
                        <Td className="text-center">
                          {formatDuration(entry.clockIn, entry.clockOut)}
                        </Td>
                        <Td>
                          <HStack className="justify-center">
                            <Button
                              variant="ghost"
                              onClick={() => startEdit(entry)}
                            >
                              <LuPencil className="size-3.5" />
                            </Button>
                            <fetcher.Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="deleteEntry"
                              />
                              <input
                                type="hidden"
                                name="entryId"
                                value={entry.id}
                              />
                              <Button variant="ghost" type="submit">
                                <LuTrash className="size-3.5" />
                              </Button>
                            </fetcher.Form>
                          </HStack>
                        </Td>
                      </Tr>
                    )
                  )
                )}
              </Tbody>
            </TableBase>

            {entries.length > 0 && (
              <div className="mt-4 text-right text-sm font-medium">
                Total: {formatTotalHours(entries)}
              </div>
            )}
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
}
