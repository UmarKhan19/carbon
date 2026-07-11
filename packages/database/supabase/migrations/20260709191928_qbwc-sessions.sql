-- QuickBooks Desktop Web Connector session state
-- Spec: .ai/specs/2026-07-09-accounting-sync-engine.md (Phase D)
-- The ERP runs serverless, so QBWC sessions (ticket, in-flight batch,
-- message-set recovery id) must live in the database, not instance memory.

CREATE TABLE IF NOT EXISTS "qbwcSession" (
    "id" TEXT NOT NULL DEFAULT id('qbwc'),        -- doubles as the opaque QBWC session ticket
    "companyId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,                   -- 'quickbooks-desktop'
    "status" TEXT NOT NULL DEFAULT 'Open' CHECK ("status" IN ('Open','Closed','Error')),
    "currentMessageSetId" TEXT,                    -- newMessageSetID of the in-flight batch (crash recovery)
    "claimedOperationIds" TEXT[],                  -- accountingSyncOperation ids in the in-flight batch
    "requestsSent" INTEGER NOT NULL DEFAULT 0,
    "qbxmlMajorVersion" TEXT,                      -- from the session's sendRequestXML handshake
    "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "closedAt" TIMESTAMP WITH TIME ZONE,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),  -- the user who created the connection credentials
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "qbwcSession_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "qbwcSession_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "qbwcSession_companyId_idx"
  ON "qbwcSession" ("companyId");
CREATE INDEX IF NOT EXISTS "qbwcSession_health_idx"
  ON "qbwcSession" ("companyId", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "qbwcSession_createdBy_idx"
  ON "qbwcSession" ("createdBy");
CREATE INDEX IF NOT EXISTS "qbwcSession_updatedBy_idx"
  ON "qbwcSession" ("updatedBy");

ALTER TABLE "qbwcSession" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."qbwcSession";
CREATE POLICY "SELECT" ON "public"."qbwcSession" FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- No INSERT/UPDATE/DELETE policies: all writes come from the QBWC SOAP
-- endpoint via the service role.
