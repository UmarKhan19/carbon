// Fires one `carbon/notify` event per notification type using whatever
// records already exist in the target database. Useful for smoke-testing the
// notify pipeline (in-app row + email render + slack fan-out) end-to-end
// against the local Inngest dev server.
//
// Usage:
//   tsx scripts/notification-test.ts <userId> <companyId> [--destinations=inApp,email]
//
// Env (loaded from .env):
//   SUPABASE_URL              — points at the Supabase you want to read from
//   SUPABASE_SERVICE_ROLE_KEY     — service role; bypasses RLS so we can query
//   INNGEST_BASE_URL              — defaults to http://localhost:8288 (dev server)

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Inngest } from "inngest";
import { ApprovalDocumentType } from '../apps/erp/app/modules/shared';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INNGEST_BASE_URL =
  process.env.INNGEST_BASE_URL ?? "http://localhost:8288";

const argv = process.argv.slice(2);
const wantsList = argv.includes("--list");

const positional = argv.filter((a) => !a.startsWith("--"));
const [userIdArg, companyIdArg] = positional;
const flags = argv.filter((a) => a.startsWith("--"));

const destinationsFlag = flags.find((a) => a.startsWith("--destinations="));
const destinations = destinationsFlag
  ? destinationsFlag.split("=")[1]!.split(",")
  : ["inApp"];

const eventFlag = flags.find((a) => a.startsWith("--event="));
const eventFilter = eventFlag ? eventFlag.split("=")[1] : undefined;

if (!wantsList && (!userIdArg || !companyIdArg)) {
  console.error(
    "Usage:\n" +
      "  tsx scripts/notification-test.ts --list\n" +
      "  tsx scripts/notification-test.ts <userId> <companyId> [--event=<event>] [--destinations=inApp,email,slack]"
  );
  process.exit(1);
}

if (wantsList) {
  const eventValues = [
    "approval-approved",
    "approval-rejected",
    "approval-requested",
    "digital-quote-response",
    "gauge-calibration-expired",
    "job-assignment",
    "job-completed",
    "job-operation-assignment",
    "job-operation-message",
    "maintenance-dispatch-assignment",
    "maintenance-dispatch-created",
    "issue-assignment",
    "procedure-assignment",
    "quote-assignment",
    "risk-assignment",
    "sales-order-assignment",
    "sales-rfq-assignment",
    "sales-rfq-ready",
    "stock-transfer-assignment",
    "suggestion-response",
    "supplier-quote-response",
    "training-assignment"
  ];
  console.log("Available --event values:\n");
  for (const e of eventValues) console.log(`  ${e}`);
  process.exit(0);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const inngest = new Inngest({
  baseUrl: INNGEST_BASE_URL,
  id: "notification-test-script",
  isDev: true
});

// Mirrors NotificationEvent in @carbon/notifications. Inlined to avoid the
// workspace import dance in a one-off script.
const Event = {
  ApprovalApproved: "approval-approved",
  ApprovalRejected: "approval-rejected",
  ApprovalRequested: "approval-requested",
  DigitalQuoteResponse: "digital-quote-response",
  GaugeCalibrationExpired: "gauge-calibration-expired",
  JobAssignment: "job-assignment",
  JobCompleted: "job-completed",
  JobOperationAssignment: "job-operation-assignment",
  JobOperationMessage: "job-operation-message",
  MaintenanceDispatchAssignment: "maintenance-dispatch-assignment",
  MaintenanceDispatchCreated: "maintenance-dispatch-created",
  NonConformanceAssignment: "issue-assignment",
  ProcedureAssignment: "procedure-assignment",
  QuoteAssignment: "quote-assignment",
  RiskAssignment: "risk-assignment",
  SalesOrderAssignment: "sales-order-assignment",
  SalesRfqAssignment: "sales-rfq-assignment",
  SalesRfqReady: "sales-rfq-ready",
  StockTransferAssignment: "stock-transfer-assignment",
  SuggestionResponse: "suggestion-response",
  SupplierQuoteResponse: "supplier-quote-response",
  TrainingAssignment: "training-assignment"
} as const;

type ResolveResult =
  | { ok: true; documentId: string; documentType?: string; detail: string }
  | { ok: false; reason: string };

async function firstId(table: string, companyId: string): Promise<string | null> {
  const { data, error } = await (supabase.from as any)(table)
    .select("id")
    .eq("companyId", companyId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`  query ${table}:`, error.message);
    return null;
  }
  return data?.id ?? null;
}

async function resolveJobOperation(companyId: string): Promise<ResolveResult> {
  const { data, error } = await (supabase.from as any)("jobOperation")
    .select("id, jobMakeMethodId, job!inner(id, companyId)")
    .eq("job.companyId", companyId)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: `query jobOperation: ${error.message}` };
  if (!data) return { ok: false, reason: "no jobOperation rows" };
  const jobId = data.job?.id ?? "";
  const operationId = data.id;
  const makeMethodId = data.jobMakeMethodId ?? "";
  return {
    detail: `jobOperation ${operationId}`,
    documentId: `${jobId}:${operationId}:${makeMethodId}:`,
    ok: true
  };
}

async function resolveTraining(companyId: string): Promise<ResolveResult> {
  const { data, error } = await (supabase.from as any)("trainingAssignment")
    .select("id, training!inner(id, companyId)")
    .eq("training.companyId", companyId)
    .limit(1)
    .maybeSingle();
  if (error)
    return { ok: false, reason: `query trainingAssignment: ${error.message}` };
  if (!data) return { ok: false, reason: "no trainingAssignment rows" };
  return { detail: `trainingAssignment ${data.id}`, documentId: data.id, ok: true };
}

async function resolveSimple(
  table: string,
  companyId: string
): Promise<ResolveResult> {
  const id = await firstId(table, companyId);
  if (!id) return { ok: false, reason: `no ${table} rows` };
  return { detail: `${table} ${id}`, documentId: id, ok: true };
}

async function resolveApproval(
  companyId: string,
  documentType: ApprovalDocumentType
): Promise<ResolveResult> {
  const id = await firstId(documentType, companyId);
  if (!id) return { ok: false, reason: `no ${documentType} rows` };
  return {
    detail: `${documentType} ${id}`,
    documentId: id,
    documentType,
    ok: true
  };
}

const cases: Array<{
  event: string;
  resolve: () => Promise<ResolveResult>;
}> = [
  {
    event: Event.SalesRfqReady,
    resolve: () => resolveSimple("salesRfq", companyIdArg!)
  },
  {
    event: Event.SalesRfqAssignment,
    resolve: () => resolveSimple("salesRfq", companyIdArg!)
  },
  {
    event: Event.QuoteAssignment,
    resolve: () => resolveSimple("quote", companyIdArg!)
  },
  {
    event: Event.SalesOrderAssignment,
    resolve: () => resolveSimple("salesOrder", companyIdArg!)
  },
  {
    event: Event.MaintenanceDispatchCreated,
    resolve: () => resolveSimple("maintenanceDispatch", companyIdArg!)
  },
  {
    event: Event.MaintenanceDispatchAssignment,
    resolve: () => resolveSimple("maintenanceDispatch", companyIdArg!)
  },
  {
    event: Event.NonConformanceAssignment,
    resolve: () => resolveSimple("nonConformance", companyIdArg!)
  },
  {
    event: Event.JobAssignment,
    resolve: () => resolveSimple("job", companyIdArg!)
  },
  {
    event: Event.JobCompleted,
    resolve: () => resolveSimple("job", companyIdArg!)
  },
  {
    event: Event.JobOperationAssignment,
    resolve: () => resolveJobOperation(companyIdArg!)
  },
  {
    event: Event.JobOperationMessage,
    resolve: () => resolveJobOperation(companyIdArg!)
  },
  {
    event: Event.ProcedureAssignment,
    resolve: () => resolveSimple("procedure", companyIdArg!)
  },
  {
    event: Event.DigitalQuoteResponse,
    resolve: () => resolveSimple("quote", companyIdArg!)
  },
  {
    event: Event.GaugeCalibrationExpired,
    resolve: () => resolveSimple("gaugeCalibrationRecord", companyIdArg!)
  },
  {
    event: Event.StockTransferAssignment,
    resolve: () => resolveSimple("stockTransfer", companyIdArg!)
  },
  {
    event: Event.TrainingAssignment,
    resolve: () => resolveTraining(companyIdArg!)
  },
  {
    event: Event.SuggestionResponse,
    resolve: () => resolveSimple("suggestion", companyIdArg!)
  },
  {
    event: Event.RiskAssignment,
    resolve: () => resolveSimple("riskRegister", companyIdArg!)
  },
  {
    event: Event.SupplierQuoteResponse,
    resolve: () => resolveSimple("supplierQuote", companyIdArg!)
  },
  {
    event: Event.ApprovalRequested,
    resolve: () => resolveApproval(companyIdArg!, "purchaseOrder")
  },
  {
    event: Event.ApprovalApproved,
    resolve: () => resolveApproval(companyIdArg!, "purchaseOrder")
  },
  {
    event: Event.ApprovalRejected,
    resolve: () => resolveApproval(companyIdArg!, "purchaseOrder")
  }
];

(async () => {
  const filtered = eventFilter
    ? cases.filter((c) => c.event === eventFilter)
    : cases;

  if (filtered.length === 0) {
    console.error(
      `No event matched "${eventFilter}". Run with --list to see options.`
    );
    process.exit(1);
  }

  console.log(
    `Sending ${filtered.length} notification(s) to ${INNGEST_BASE_URL} for user ${userIdArg} (company ${companyIdArg})\n` +
      `Destinations: ${destinations.join(", ")}\n`
  );

  const results: Array<{ event: string; status: string; detail: string }> = [];

  for (const c of filtered) {
    const resolved = await c.resolve();
    if (!resolved.ok) {
      results.push({ detail: resolved.reason, event: c.event, status: "skip" });
      continue;
    }

    try {
      await inngest.send({
        data: {
          companyId: companyIdArg,
          destinations,
          documentId: resolved.documentId,
          documentType: resolved.documentType,
          event: c.event,
          recipient: { type: "user", userId: userIdArg }
        },
        name: "carbon/notify"
      });
      results.push({ detail: resolved.detail, event: c.event, status: "sent" });
    } catch (err) {
      results.push({
        detail: err instanceof Error ? err.message : String(err),
        event: c.event,
        status: "error"
      });
    }
  }

  console.table(results);
})();
