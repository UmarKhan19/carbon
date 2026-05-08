import { useCarbon, useRealtimeChannel } from "@carbon/react";
import { useCallback, useEffect, useMemo, useState } from "react";

// Topbar shape — matches the surface the old Novu IMessage exposed so
// consumers don't change. `payload` mirrors what notify.ts writes into the
// notification row's payload jsonb column.
export type Notification = {
  _id: string;
  read: boolean;
  seen: boolean;
  createdAt: string;
  payload: {
    recordId?: string;
    description?: string;
    event?: string;
    from?: string;
    documentType?: string;
  };
};

type NotificationRow = {
  id: string;
  userId: string;
  companyId: string;
  readAt: string | null;
  seenAt: string | null;
  createdAt: string;
  payload: Notification["payload"] | null;
};

function rowToNotification(row: NotificationRow): Notification {
  return {
    _id: row.id,
    createdAt: row.createdAt,
    payload: row.payload ?? {},
    read: row.readAt !== null,
    seen: row.seenAt !== null
  };
}

export function useNotifications({
  userId,
  companyId
}: {
  userId: string;
  companyId: string;
}) {
  const { carbon } = useCarbon();
  const [isLoading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Initial fetch — runs once per (carbon/user/company) tuple.
  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await (carbon.from as any)("notification")
        .select("id, userId, companyId, readAt, seenAt, createdAt, payload")
        .eq("userId", userId)
        .eq("companyId", companyId)
        .is("digestedInto", null)
        .order("createdAt", { ascending: false })
        .limit(100);

      if (cancelled) return;
      if (error) {
        console.error("Failed to load notifications", error);
        setLoading(false);
        return;
      }
      setNotifications(
        ((data ?? []) as NotificationRow[]).map(rowToNotification)
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [carbon, userId, companyId]);

  // Realtime stream — useRealtimeChannel waits for isRealtimeAuthSet so RLS
  // policies on `notification` resolve via the user's JWT.
  useRealtimeChannel({
    dependencies: [userId, companyId],
    setup(channel) {
      return channel.on(
        // biome-ignore lint/suspicious/noExplicitAny: realtime types lag schema
        "postgres_changes" as any,
        {
          event: "*",
          filter: `userId=eq.${userId}`,
          schema: "public",
          table: "notification"
        },
        (payload: {
          eventType: string;
          new: NotificationRow;
          old: NotificationRow;
        }) => {
          if (payload.new && payload.new.companyId !== companyId) return;
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => [
              rowToNotification(payload.new),
              ...prev
            ]);
          } else if (payload.eventType === "UPDATE") {
            // A row that just got attached to a digest disappears from the
            // topbar — it's now represented by its digest parent.
            const newRow = payload.new as NotificationRow & {
              digestedInto?: string | null;
            };
            if (newRow.digestedInto) {
              setNotifications((prev) =>
                prev.filter((n) => n._id !== newRow.id)
              );
            } else {
              setNotifications((prev) =>
                prev.map((n) =>
                  n._id === newRow.id ? rowToNotification(newRow) : n
                )
              );
            }
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) =>
              prev.filter((n) => n._id !== (payload.old as NotificationRow).id)
            );
          }
        }
      );
    },
    topic: `notification:${companyId}:${userId}`
  });

  const markMessageAsRead = useCallback(
    async (messageId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n._id === messageId ? { ...n, read: true } : n))
      );
      if (!carbon) return;
      const now = new Date().toISOString();
      await (carbon.from as any)("notification")
        .update({ readAt: now })
        .eq("id", messageId);
      // If this is a digest row, sweep its children read too. RLS scopes
      // both updates to auth.uid()::text = userId, so a malicious id won't
      // affect anyone else.
      await (carbon.from as any)("notification")
        .update({ readAt: now })
        .eq("digestedInto", messageId)
        .is("readAt", null);
    },
    [carbon]
  );

  const markAllMessagesAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!carbon) return;
    await (carbon.from as any)("notification")
      .update({ readAt: new Date().toISOString() })
      .eq("userId", userId)
      .eq("companyId", companyId)
      .is("readAt", null);
  }, [carbon, userId, companyId]);

  const markAllMessagesAsSeen = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, seen: true })));
    if (!carbon) return;
    await (carbon.from as any)("notification")
      .update({ seenAt: new Date().toISOString() })
      .eq("userId", userId)
      .eq("companyId", companyId)
      .is("seenAt", null);
  }, [carbon, userId, companyId]);

  const hasUnseenNotifications = useMemo(
    () => notifications.some((n) => !n.seen),
    [notifications]
  );

  return {
    hasUnseenNotifications,
    isLoading,
    markAllMessagesAsRead,
    markAllMessagesAsSeen,
    markMessageAsRead,
    notifications
  };
}
