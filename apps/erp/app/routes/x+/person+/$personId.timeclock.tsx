import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useParams
} from "react-router";
import { getCompanySettings } from "~/modules/settings";
import {
  clockIn,
  clockInValidator,
  clockOut,
  clockOutValidator,
  deleteTimeClockEntry,
  deleteTimeClockEntryValidator,
  getOpenClockEntry,
  getTimeClockEntries,
  updateTimeClockEntry,
  updateTimeClockEntryValidator
} from "~/modules/timeclock";
import { path } from "~/utils/path";

function getWeekBounds(offset: number = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
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

function formatDuration(clockIn: string, clockOut: string | null) {
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const ms = end - new Date(clockIn).getTime();
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

/** Format a UTC date string to a local datetime-local input value */
function toLocalDatetimeInput(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

  const [entries, openEntry, companySettings] = await Promise.all([
    getTimeClockEntries(client, {
      employeeId: personId,
      companyId,
      from,
      to
    }),
    getOpenClockEntry(client, personId, companyId),
    getCompanySettings(client, companyId)
  ]);

  if (!companySettings.data?.timeClockEnabled) {
    throw redirect(path.to.personDetails(personId));
  }

  return {
    entries: entries.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    from,
    to
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const validation = await validator(clockInValidator).validate(formData);
    if (validation.error) return data({}, { status: 400 });

    const employeeId = validation.data.employeeId || personId;
    const result = await clockIn(client, {
      employeeId,
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
    const validation = await validator(clockOutValidator).validate(formData);
    if (validation.error) return data({}, { status: 400 });

    const employeeId = validation.data.employeeId || personId;
    const result = await clockOut(client, {
      employeeId,
      companyId,
      updatedBy: userId,
      note: validation.data.note
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Clocked out")));
  }

  if (intent === "updateEntry") {
    const validation = await validator(updateTimeClockEntryValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await updateTimeClockEntry(client, {
      entryId: validation.data.entryId,
      clockIn: validation.data.clockIn,
      clockOut: validation.data.clockOut || null,
      note: validation.data.note || null,
      updatedBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to update entry"))
      );
    }
    return data({}, await flash(request, success("Entry updated")));
  }

  if (intent === "deleteEntry") {
    const validation = await validator(deleteTimeClockEntryValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await deleteTimeClockEntry(client, validation.data.entryId);
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to delete entry"))
      );
    }
    return data({}, await flash(request, success("Entry deleted")));
  }

  return data({}, { status: 400 });
}

export default function PersonTimeClockRoute() {
  const { entries, openEntry, weekOffset, from, to } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();
  const fetcher = useFetcher<typeof action>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editNote, setEditNote] = useState("");
  const [, setTick] = useState(0);

  // Update live durations every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setEditingId(null);
    }
  }, [fetcher.data, fetcher.state]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    note: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDatetimeInput(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDatetimeInput(entry.clockOut) : "");
    setEditNote(entry.note ?? "");
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <HStack className="justify-between items-center">
          <CardTitle>Time Clock</CardTitle>
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
        {openEntry && (
          <Badge variant="outline" className="w-fit">
            Clocked in since {formatTime(openEntry.clockIn)}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <HStack className="justify-between items-center mb-4">
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`${path.to.personTimeClock(personId!)}?week=${weekOffset - 1}`}
            >
              <LuChevronLeft className="size-4" />
              Prev Week
            </a>
          </Button>
          <span className="text-sm text-muted-foreground">
            {formatDate(monday.toISOString(), { dateStyle: "medium" })} —{" "}
            {formatDate(sunday.toISOString(), { dateStyle: "medium" })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={isCurrentWeek}
            asChild={!isCurrentWeek}
          >
            {isCurrentWeek ? (
              <span>
                Next Week
                <LuChevronRight className="size-4" />
              </span>
            ) : (
              <a
                href={`${path.to.personTimeClock(personId!)}?week=${weekOffset + 1}`}
              >
                Next Week
                <LuChevronRight className="size-4" />
              </a>
            )}
          </Button>
        </HStack>

        <TableBase className="table-fixed w-full">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[28%]" />
            <col className="w-[28%]" />
            <col className="w-[12%]" />
            <col className="w-[18%]" />
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
                        className="h-8 text-sm w-full"
                      />
                    </Td>
                    <Td>
                      <Input
                        type="datetime-local"
                        value={editClockOut}
                        onChange={(e) => setEditClockOut(e.target.value)}
                        className="h-8 text-sm w-full"
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
                            value={new Date(editClockIn).toISOString()}
                          />
                          {editClockOut && (
                            <input
                              type="hidden"
                              name="clockOut"
                              value={new Date(editClockOut).toISOString()}
                            />
                          )}
                          <input type="hidden" name="note" value={editNote} />
                          <Button
                            variant="ghost"
                            size="sm"
                            type="submit"
                            className="w-full hover:bg-emerald-100 hover:text-emerald-700"
                          >
                            Save
                          </Button>
                        </fetcher.Form>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          className="w-full hover:bg-red-100 hover:text-red-700"
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
                        <Badge
                          variant="outline"
                          className="text-emerald-600 border-emerald-600"
                        >
                          Active
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-center">
                      {formatDuration(entry.clockIn, entry.clockOut)}
                    </Td>
                    <Td>
                      <HStack className="justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
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
                          <Button variant="ghost" size="sm" type="submit">
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
  );
}
