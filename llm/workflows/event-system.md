# Event System Workflow

This workflow describes how to use Carbon's Event System to create reactive workflows triggered by database changes.

## Prerequisites

- Understand the event system architecture (see `llm/cache/event-system.md`)
- Have access to the Supabase client (`getCarbonServiceRole()`)
- Know which table you want to watch and what handler type to use

## Use Cases

| Use Case               | Handler Type | Example                                   |
| ---------------------- | ------------ | ----------------------------------------- |
| Notify external system | `WEBHOOK`    | Send Slack message when order created     |
| Sync to accounting     | `SYNC`       | Push new customer to Xero                 |
| Internal automation    | `WORKFLOW`   | Auto-assign tasks when job status changes |
| Update search index    | `SEARCH`     | Re-index customer after update            |
| Audit log              | `AUDIT`      | Record change history                     |
| Embedding index        | `EMBEDDING`  | Update vector embeddings                  |

---

## Workflow A: Create a Webhook Subscription

### Step 1: Ensure Event Trigger is Attached to Table

Check if the table already has an event trigger:

```sql
SELECT * FROM "eventSystemTrigger" WHERE "table" = 'yourTable';
```

If not attached, create a migration to attach it:

```sql
SELECT attach_event_trigger('yourTable', ARRAY[]::TEXT[]);
```

### Step 2: Create the Subscription

```typescript
import { getCarbonServiceRole } from "@carbon/auth";
import { createEventSystemSubscription } from "@carbon/database/event";

const client = getCarbonServiceRole();

const subscription = await createEventSystemSubscription(client, {
  name: "my-webhook-subscription", // Unique per company
  table: "salesOrder", // Table to watch
  companyId: companyId, // Your company ID
  operations: ["INSERT", "UPDATE"], // Which operations to trigger on
  type: "WEBHOOK",
  config: {
    url: "https://your-webhook-endpoint.com/webhook",
    headers: {
      Authorization: "Bearer your-token",
      "Content-Type": "application/json",
    },
  },
  filter: { status: "confirmed" }, // Optional: only trigger for specific rows
  active: true,
});

console.log("Created subscription:", subscription.id);
```

### Step 3: Handle the Webhook

Your endpoint will receive POST requests with this payload:

```json
{
  "table": "salesOrder",
  "operation": "INSERT",
  "recordId": "so_abc123",
  "new": {
    /* full row data */
  },
  "old": null,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Workflow B: Create a SYNC Subscription (Accounting)

### Step 1: Ensure Accounting Integration is Configured

The company must have an active accounting integration (Xero, QuickBooks).

### Step 2: Create the Subscription

```typescript
const subscription = await createEventSystemSubscription(client, {
  name: "sync-customers-to-xero",
  table: "customer",
  companyId: companyId,
  operations: ["INSERT", "UPDATE"],
  type: "SYNC",
  config: {
    provider: "xero", // or "quickbooks"
  },
  active: true,
});
```

### Step 3: The sync handler will automatically:

1. Fetch the full customer record
2. Transform it to accounting provider format
3. Push to the external system
4. Track sync status in `externalIntegrationMapping`

---

## Workflow C: Add a New Handler Type

### Step 1: Update the Handler Type Enum

In `packages/database/src/event.ts`:

```typescript
const HandlerTypeSchema = z.enum([
  "WEBHOOK",
  "WORKFLOW",
  "SYNC",
  "SEARCH",
  "AUDIT",
  "EMBEDDING",
  "YOUR_NEW_TYPE",
]);
```

### Step 2: Update the Database Constraint

Create a migration:

```sql
ALTER TABLE "eventSystemSubscription"
DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";

ALTER TABLE "eventSystemSubscription"
ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
CHECK ("handlerType" IN ('WEBHOOK', 'WORKFLOW', 'SYNC', 'SEARCH', 'AUDIT', 'EMBEDDING', 'YOUR_NEW_TYPE'));
```

### Step 3: Register the Event Name

In `packages/jobs/src/events.ts`, add a new entry to the `Events` type:

```typescript
export type Events = {
  // ...existing events...
  "carbon/event-your-new-type": {
    data: {
      msgId: number;
      data: {
        // Payload shape your handler expects
        table: string;
        operation: "INSERT" | "UPDATE" | "DELETE";
        recordId: string;
        new: Record<string, any> | null;
        old: Record<string, any> | null;
        timestamp: string;
        companyId: string;
        handlerConfig: Record<string, any>;
      };
    };
  };
};
```

### Step 4: Create the Handler Function

Create `packages/jobs/src/inngest/functions/events/your-handler.ts`:

```typescript
import { z } from "zod";
import { inngest } from "../../client.ts";

const yourPayloadSchema = z.object({
  msgId: z.number(),
  data: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
    recordId: z.string(),
    new: z.record(z.any()).nullable(),
    old: z.record(z.any()).nullable(),
    timestamp: z.string(),
    companyId: z.string(),
    handlerConfig: z.record(z.any()),
  }),
});

export type YourPayload = z.infer<typeof yourPayloadSchema>;

export const yourHandlerFunction = inngest.createFunction(
  {
    id: "event-handler-your-new-type",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 0,
      key: "event.data.data.table + '-' + event.data.data.recordId",
    },
  },
  { event: "carbon/event-your-new-type" },
  async ({ event, step }) => {
    const payload = yourPayloadSchema.parse(event.data);

    await step.run("process-event", async () => {
      // Your handler logic here
      console.log(
        `Processing ${payload.data.table} ${payload.data.operation}`
      );
    });
  },
);
```

### Step 5: Register the Function

In `packages/jobs/src/inngest/index.ts` (or wherever `functions` is exported), add the new function to the exported array so it's served by the Inngest handler.

### Step 6: Update the Queue Router

In `packages/jobs/src/inngest/functions/events/queue.ts`:

```typescript
// Add to grouped types
const grouped: Record<HandlerType, QueueJob[]> = {
  WEBHOOK: [],
  WORKFLOW: [],
  SYNC: [],
  SEARCH: [],
  AUDIT: [],
  EMBEDDING: [],
  YOUR_NEW_TYPE: [], // Add this
};

// In the event dispatch section, add a new step.sendEvent() block for the
// new handler type. For per-row dispatch (like WEBHOOK):

if (grouped.YOUR_NEW_TYPE.length > 0) {
  const events = grouped.YOUR_NEW_TYPE.map((job) => ({
    name: "carbon/event-your-new-type" as const,
    data: {
      msgId: job.msg_id,
      data: {
        ...job.message.event,
        companyId: job.message.companyId,
        handlerConfig: job.message.handlerConfig,
      },
    },
  }));

  // Chunk to stay under Inngest's 256KB event size limit
  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    await step.sendEvent(
      `send-your-new-type-${i}`,
      events.slice(i, i + CHUNK_SIZE),
    );
  }
}
```

For batch dispatch (like SYNC/SEARCH/AUDIT/EMBEDDING), send a single event whose `data` is an array of records instead of one event per row.

---

## Workflow D: Attach Event Triggers to a New Table

### Step 1: Create Migration

```sql
-- Attach async event trigger (no sync interceptors)
SELECT attach_event_trigger('yourNewTable', ARRAY[]::TEXT[]);

-- OR with sync interceptors (functions run synchronously before the operation)
SELECT attach_event_trigger('yourNewTable', ARRAY['validate_before_insert']::TEXT[]);
```

### Step 2: Create Subscriptions for Existing Companies (if needed)

```sql
-- Example: Create search subscriptions for all companies
DO $$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN SELECT id FROM "company" LOOP
    INSERT INTO "eventSystemSubscription" (
      "name", "table", "companyId", "operations",
      "handlerType", "config", "filter", "active"
    )
    VALUES (
      'search-index-yourNewTable',
      'yourNewTable',
      company_record.id,
      ARRAY['INSERT', 'UPDATE', 'DELETE'],
      'SEARCH',
      '{}'::jsonb,
      '{}'::jsonb,
      TRUE
    )
    ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company" DO NOTHING;
  END LOOP;
END $$;
```

---

## Workflow E: Delete a Subscription

### By ID

```typescript
import { deleteEventSystemSubscription } from "@carbon/database/event";

await deleteEventSystemSubscription(client, subscriptionId);
```

### By Name (for a company)

```typescript
import { deleteEventSystemSubscriptionsByName } from "@carbon/database/event";

await deleteEventSystemSubscriptionsByName(
  client,
  companyId,
  "my-webhook-subscription",
);
```

---

## Debugging

### Check if Subscription Exists

```sql
SELECT * FROM "eventSystemSubscription"
WHERE "companyId" = 'your-company-id'
  AND "table" = 'yourTable'
  AND "active" = TRUE;
```

### Check PGMQ Queue

```sql
-- Queue metrics
SELECT * FROM pgmq.metrics('event_system');

-- Peek at pending messages
SELECT * FROM pgmq.read('event_system', 30, 10);
```

### Check Inngest Dashboard

1. Production: go to https://app.inngest.com/ and open the Carbon app
2. Find the `event-queue` function (cron, runs every minute) to verify PGMQ is being drained
3. Check downstream handler functions (`event-handler-webhook`, `event-handler-sync`, `event-handler-search`, `event-handler-audit`, `event-handler-embedding`, `event-handler-workflow`)
4. Review the run log, inputs, step outputs, and any errors

### Local Development

The Inngest Dev Server runs locally against the ERP app:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The dev server UI is at http://localhost:8288 and shows the same functions, events, and runs as the cloud dashboard.

### Test a Subscription Manually

Insert/update a row in the watched table and verify:

1. Message appears in PGMQ queue (within same transaction)
2. `event-queue` picks it up (within 1 minute)
3. Handler function executes successfully (visible in Inngest dashboard)

---

## Common Pitfalls

1. **Forgetting to attach trigger**: Table must have event trigger attached via `attach_event_trigger()`
2. **Missing companyId**: Subscriptions are company-scoped; events without companyId are skipped
3. **Wrong operation array**: Use `["INSERT"]` not `["insert"]` (uppercase)
4. **Filter not matching**: JSONB filter uses `@>` containment operator
5. **Handler not registered**: New Inngest functions must be exported in `packages/jobs/src/inngest/index.ts` so they're served by `/api/inngest`
6. **Event size limit**: Inngest caps events at 256KB — always chunk batch dispatches (see `CHUNK_SIZE` in `queue.ts`)
7. **Missing idempotency key**: Without `idempotency: "event.data.msgId"` on the handler, retries may re-process the same PGMQ message

---

## Checklist

- [ ] Event trigger attached to table (check `eventSystemTrigger` view)
- [ ] Subscription created with correct `companyId`
- [ ] Handler type matches your use case
- [ ] Config contains required fields for handler type
- [ ] Filter (if used) matches expected row structure
- [ ] Handler function is registered in `packages/jobs/src/inngest/index.ts`
- [ ] Queue router (`queue.ts`) routes the new handler type
- [ ] Event name is declared in `packages/jobs/src/events.ts`
- [ ] Tested with a real database operation (verified in Inngest dashboard)
