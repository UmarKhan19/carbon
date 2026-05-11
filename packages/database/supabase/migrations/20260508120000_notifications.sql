-- In-app notification store. Replaces Novu cloud storage so we own the data
-- and can stream changes to clients via Supabase Realtime instead of Novu's
-- WebSocket service.

CREATE TABLE "notification" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "topic" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "from" TEXT,
  "documentType" TEXT,
  "recordId" TEXT,
  "href" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "readAt" TIMESTAMP WITH TIME ZONE,
  "seenAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Hot path: fetch a user's recent notifications in one company.
CREATE INDEX "notification_user_company_created_idx"
  ON "notification" ("userId", "companyId", "createdAt" DESC);

-- Unread count query.
CREATE INDEX "notification_user_unread_idx"
  ON "notification" ("userId", "companyId", "topic")
  WHERE "readAt" IS NULL;

ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;

-- Users can read only their own notifications.
CREATE POLICY "SELECT" ON "public"."notification"
FOR SELECT USING (
  "userId" = auth.uid()::text
);

-- Users can mark their own notifications read/seen.
CREATE POLICY "UPDATE" ON "public"."notification"
FOR UPDATE USING (
  "userId" = auth.uid()::text
);

-- Inserts come from server-side jobs running with the service role, which
-- bypasses RLS. No user-facing INSERT policy.

ALTER PUBLICATION supabase_realtime ADD TABLE "notification";
