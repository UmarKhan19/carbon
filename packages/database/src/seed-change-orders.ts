/**
 * Change Orders seed script for Carbon
 *
 * Populates rich, re-runnable test data for the Change Orders (ECO) feature:
 * a bike-manufacturer catalog (parts, make methods with BOM + BOP), downstream
 * documents (open PO, in-progress job, sales order), an NCR, and seven change
 * orders spanning every stage of the PRD flow (Draft → Start → Engineering
 * Complete → Implementation → Done) plus the optional approval gate.
 *
 * The pg connection needs SUPABASE_DB_URL, which lives in the repo-root
 * `.env.local` (not `.env`). Both are loaded below.
 *
 * Usage:
 *   set -a; . ./.env.local; set +a
 *   pnpm --filter @carbon/database seed:change-orders -- --company <companyId>
 *   pnpm --filter @carbon/database seed:change-orders -- --email <email>
 *
 * Idempotency: at the start of the transaction the script deletes its own prior
 * seed for the company (by the exact readableIds / names it owns), so re-running
 * is clean and never touches unrelated data.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as dotenv from "dotenv";
import type { PoolClient } from "pg";
import { getPostgresConnectionPool } from "./client.ts";

// ---------------------------------------------------------------------------
// Environment — SUPABASE_DB_URL is in the repo-root .env.local (not .env).
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ -> packages/database/ -> packages/ -> repo root
const repoRoot = path.resolve(__dirname, "..", "..", "..");
dotenv.config();
for (const envPath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local")
]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    company: { type: "string", short: "c" },
    email: { type: "string", short: "e" }
  },
  strict: true
});

// ---------------------------------------------------------------------------
// Constants — the exact identifiers this script owns (used for delete-first).
// ---------------------------------------------------------------------------
const RICH = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  });

// Purchased (Buy) parts — PRT-001186 appears twice (rev 0 = ".A", rev B = ".B").
const PURCHASED_PARTS = [
  { readableId: "PRT-001186", revision: "0", name: "Rear Dropout Bracket" },
  { readableId: "PRT-001186", revision: "B", name: "Rear Dropout Bracket v2" },
  { readableId: "FST-100", revision: "0", name: "M5 Bolt" },
  { readableId: "FST-101", revision: "0", name: "Alignment Dowel" },
  { readableId: "FST-102", revision: "0", name: "Locking Washer" },
  { readableId: "BRG-200", revision: "0", name: "Sealed Bearing" },
  { readableId: "CBL-300", revision: "0", name: "Cable Housing" }
] as const;

// Make parts — each gets an Active makeMethod with a BOM + BOP.
const MAKE_PARTS = [
  { readableId: "GA-0020", name: "Pedal4 Sync3 Stage 2" },
  { readableId: "GA-0022", name: "Pedal4 Sync3 Stage 3" },
  { readableId: "GA-0044", name: "Pedal4 Sync3 Stage 2 Alt" },
  { readableId: "SA-0065", name: "Pedal2 Sync3" },
  { readableId: "VEH0000001", name: "Pedal4 Sync3" },
  { readableId: "VEH000006", name: "Pedal2 Sync2" }
] as const;

const ALL_SEEDED_ITEM_IDS = [
  ...PURCHASED_PARTS.map((p) => p.readableId),
  ...MAKE_PARTS.map((p) => p.readableId)
];

const PROCESS_NAMES = ["Machining", "Welding", "Assembly", "Inspection"];
const WORK_CENTER_NAMES = [
  "CNC Mill",
  "Weld Cell",
  "Assembly Line 1",
  "QC Bench"
];
const SUPPLIER_NAMES = ["FastenerCo", "BracketWorks"];
const CUSTOMER_NAMES = ["VeloRetail", "CityBikes"];

const PO_ID = "PO-CO-001";
const JOB_ID = "J-CO-001";
const SO_ID = "SO-CO-001";
const NCR_ID = "NCR-CO-001";
const CHANGE_ORDER_IDS = [
  "CO-000001",
  "CO-000002",
  "CO-000003",
  "CO-000004",
  "CO-000005",
  "CO-000006",
  "CO-000007"
];

// ---------------------------------------------------------------------------
// Company / context resolution
// ---------------------------------------------------------------------------
async function resolveContext(client: PoolClient) {
  let companyId = values.company;

  if (!companyId && values.email) {
    const res = await client.query(
      `SELECT utc."companyId"
       FROM "userToCompany" utc
       JOIN "user" u ON u.id = utc."userId"
       WHERE u.email = $1
       LIMIT 1`,
      [values.email]
    );
    if (res.rows.length === 0) {
      throw new Error(`No company found for email ${values.email}`);
    }
    companyId = res.rows[0].companyId;
  }

  if (!companyId) {
    // Fall back to the single non-system company if exactly one exists.
    const res = await client.query(
      `SELECT id FROM company WHERE id NOT IN ('system')`
    );
    if (res.rows.length === 1) {
      companyId = res.rows[0].id;
    } else {
      throw new Error(
        `Could not resolve company: pass --company <id> or --email <email> ` +
          `(found ${res.rows.length} companies).`
      );
    }
  }

  const companyRes = await client.query(
    `SELECT id, name FROM company WHERE id = $1`,
    [companyId]
  );
  if (companyRes.rows.length === 0) {
    throw new Error(`Company ${companyId} not found`);
  }
  const companyName = companyRes.rows[0].name as string;

  const userRes = await client.query(
    `SELECT "userId" FROM "userToCompany" WHERE "companyId" = $1 AND role = 'employee' LIMIT 1`,
    [companyId]
  );
  if (userRes.rows.length === 0) {
    throw new Error(`No employee user found for company ${companyId}`);
  }
  const userId = userRes.rows[0].userId as string;

  const locRes = await client.query(
    `SELECT id FROM location WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );
  if (locRes.rows.length === 0) {
    throw new Error(`No location found for company ${companyId}`);
  }
  const locationId = locRes.rows[0].id as string;

  const nctRes = await client.query(
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );
  if (nctRes.rows.length === 0) {
    throw new Error(`No nonConformanceType found for company ${companyId}`);
  }
  const nonConformanceTypeId = nctRes.rows[0].id as string;

  // Ensure UoM 'EA' exists (it should for any seeded company).
  const uomRes = await client.query(
    `SELECT code FROM "unitOfMeasure" WHERE "companyId" = $1 AND code = 'EA'`,
    [companyId]
  );
  if (uomRes.rows.length === 0) {
    throw new Error(`UoM 'EA' not found for company ${companyId}`);
  }

  return {
    companyId: companyId as string,
    companyName,
    userId,
    locationId,
    nonConformanceTypeId
  };
}

// Strict lookup: records are keyed by ids we just inserted, so a miss is a seed
// bug, not a runtime "maybe". Returns a definite value (satisfies
// noUncheckedIndexedAccess) and throws with the offending key otherwise.
function need<T>(rec: Record<string, T>, key: string): T {
  const v = rec[key];
  if (v === undefined) throw new Error(`Seed: missing "${key}"`);
  return v;
}

// ---------------------------------------------------------------------------
// Idempotency — delete this script's prior seed in FK-safe order.
// ---------------------------------------------------------------------------
async function deletePriorSeed(client: PoolClient, companyId: string) {
  // 1. Change orders (children cascade via ON DELETE CASCADE).
  await client.query(
    `DELETE FROM "changeOrder" WHERE "companyId" = $1 AND "changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );

  // 2. Seeded documents referencing items (must go before items).
  await client.query(
    `DELETE FROM "purchaseOrder" WHERE "companyId" = $1 AND "purchaseOrderId" = $2`,
    [companyId, PO_ID]
  );
  await client.query(
    `DELETE FROM job WHERE "companyId" = $1 AND "jobId" = $2`,
    [companyId, JOB_ID]
  );
  await client.query(
    `DELETE FROM "salesOrder" WHERE "companyId" = $1 AND "salesOrderId" = $2`,
    [companyId, SO_ID]
  );

  // 3. Method rows for the seeded items' make methods, then the items.
  //    methodMaterial + methodOperation cascade off makeMethod, and makeMethod
  //    cascades off item — but delete children explicitly for robustness in
  //    case cascade rules differ.
  await client.query(
    `DELETE FROM "methodMaterial" mm
     USING "makeMethod" mk, item i
     WHERE mm."makeMethodId" = mk.id AND mk."itemId" = i.id
       AND i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  await client.query(
    `DELETE FROM "methodOperation" mo
     USING "makeMethod" mk, item i
     WHERE mo."makeMethodId" = mk.id AND mk."itemId" = i.id
       AND i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );

  // 4. The seeded items (makeMethod + itemCost cascade off item). The `part`
  //    extension row is positional (part.id = readableId), not FK-cascaded —
  //    delete it explicitly.
  await client.query(
    `DELETE FROM item WHERE "companyId" = $1 AND "readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  await client.query(
    `DELETE FROM part WHERE "companyId" = $1 AND id = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );

  // 5. The seeded NCR.
  await client.query(
    `DELETE FROM "nonConformance" WHERE "companyId" = $1 AND "nonConformanceId" = $2`,
    [companyId, NCR_ID]
  );

  // 6. Seeded suppliers/customers/processes/work centers (by exact name).
  await client.query(
    `DELETE FROM supplier WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, SUPPLIER_NAMES]
  );
  await client.query(
    `DELETE FROM customer WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, CUSTOMER_NAMES]
  );
  await client.query(
    `DELETE FROM "workCenter" WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, WORK_CENTER_NAMES]
  );
  await client.query(
    `DELETE FROM process WHERE "companyId" = $1 AND name = ANY($2)`,
    [companyId, PROCESS_NAMES]
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
type Ctx = {
  client: PoolClient;
  companyId: string;
  userId: string;
  locationId: string;
};

async function createPurchasedItem(
  ctx: Ctx,
  def: { readableId: string; revision: string; name: string }
): Promise<string> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO item (
      "readableId", revision, name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      active, "companyId", "createdBy"
    ) VALUES ($1, $2, $3, 'Part', 'Buy', 'Purchase to Order', 'Inventory', 'EA', true, $4, $5)
    RETURNING id`,
    [def.readableId, def.revision, def.name, companyId, userId]
  );
  const itemId = res.rows[0].id as string;
  // NB: the item-insert interceptor already creates the itemCost / itemReplenishment
  // / makeMethod rows — do NOT insert itemCost here or the `parts` view fans out
  // (it joins itemCost, so a duplicate row doubles every part in the list).
  // The `part` extension row is what the Parts list/view joins on (part.id =
  // item.readableId, per revision). ON CONFLICT: multiple revisions share one
  // part row.
  await client.query(
    `INSERT INTO part (id, "companyId", "createdBy") VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [def.readableId, companyId, userId]
  );
  return itemId;
}

async function createMakeItem(
  ctx: Ctx,
  def: { readableId: string; name: string }
): Promise<{ itemId: string; makeMethodId: string }> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO item (
      "readableId", name, type, "replenishmentSystem",
      "defaultMethodType", "itemTrackingType", "unitOfMeasureCode",
      active, "companyId", "createdBy"
    ) VALUES ($1, $2, 'Part', 'Make', 'Make to Order', 'Inventory', 'EA', true, $3, $4)
    RETURNING id`,
    [def.readableId, def.name, companyId, userId]
  );
  const itemId = res.rows[0].id as string;
  // itemCost is auto-created by the item-insert interceptor — do NOT duplicate
  // it (the `parts` view joins itemCost and would fan out). See createPurchasedItem.
  // `part` extension row (see createPurchasedItem) — required for the Parts view.
  await client.query(
    `INSERT INTO part (id, "companyId", "createdBy") VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [def.readableId, companyId, userId]
  );
  // The item insert auto-creates a Draft makeMethod via a DB interceptor.
  const mmRes = await client.query(
    `SELECT id FROM "makeMethod" WHERE "itemId" = $1 ORDER BY version LIMIT 1`,
    [itemId]
  );
  if (mmRes.rows.length === 0) {
    throw new Error(`No auto-created makeMethod for item ${def.readableId}`);
  }
  const makeMethodId = mmRes.rows[0].id as string;
  await client.query(
    `UPDATE "makeMethod" SET status = 'Active', "updatedBy" = $2 WHERE id = $1`,
    [makeMethodId, userId]
  );
  return { itemId, makeMethodId };
}

async function addBomLine(
  ctx: Ctx,
  makeMethodId: string,
  componentItemId: string,
  quantity: number,
  order: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "methodMaterial" (
      "makeMethodId", "methodType", "itemType", "itemId", quantity,
      "unitOfMeasureCode", "companyId", "createdBy", "order",
      "scrapQuantity", kit, "storageUnitIds", "sourcingType"
    ) VALUES ($1, 'Pull from Inventory', 'Part', $2, $3, 'EA', $4, $5, $6, 0, false, '{}', 'Specified')`,
    [makeMethodId, componentItemId, quantity, companyId, userId, order]
  );
}

async function addBopOperation(
  ctx: Ctx,
  makeMethodId: string,
  processId: string,
  workCenterId: string | null,
  description: string,
  order: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "methodOperation" (
      "makeMethodId", description, "companyId", "createdBy",
      "processId", "workCenterId", "order"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      makeMethodId,
      description,
      companyId,
      userId,
      processId,
      workCenterId,
      order
    ]
  );
}

// ---------------------------------------------------------------------------
// Change-order builders
// ---------------------------------------------------------------------------
type ChangeOrderInput = {
  changeOrderId: string;
  name: string;
  status: string;
  changeOrderTypeId: string;
  assignee: string | null;
  effectiveDate?: string | null;
  reasonForChange?: string;
  description?: string;
  nonConformanceId?: string | null;
};

async function createChangeOrder(
  ctx: Ctx,
  input: ChangeOrderInput
): Promise<string> {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO "changeOrder" (
      "changeOrderId", name, "openDate", "createdBy", status, "companyId",
      type, "approvalType", "changeOrderTypeId", assignee, "effectiveDate",
      "reasonForChange", "description", "nonConformanceId"
    ) VALUES ($1, $2, $3, $4, $5, $6, 'Engineering', 'Unanimous', $7, $8, $9, $10, $11, $12)
    RETURNING id`,
    [
      input.changeOrderId,
      input.name,
      "2026-07-09",
      userId,
      input.status,
      companyId,
      input.changeOrderTypeId,
      input.assignee,
      input.effectiveDate ?? null,
      RICH(input.reasonForChange ?? "Reason for change to be documented."),
      RICH(input.description ?? "Description of change to be documented."),
      input.nonConformanceId ?? null
    ]
  );
  return res.rows[0].id as string;
}

async function addProductAffected(
  ctx: Ctx,
  changeOrderId: string,
  itemId: string
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderProductAffected" ("changeOrderId", "itemId", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)`,
    [changeOrderId, itemId, companyId, userId]
  );
}

async function addBomChange(
  ctx: Ctx,
  changeOrderId: string,
  changeType: "Add" | "Delete",
  itemId: string,
  sortOrder: number,
  assemblies: {
    assemblyItemId: string;
    quantity: number;
    supersessionMode?: string | null;
  }[]
) {
  const { client, companyId, userId } = ctx;
  const res = await client.query(
    `INSERT INTO "changeOrderBomChange" ("changeOrderId", "changeType", "itemId", "companyId", "createdBy", "sortOrder")
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [changeOrderId, changeType, itemId, companyId, userId, sortOrder]
  );
  const bomChangeId = res.rows[0].id as string;
  for (const a of assemblies) {
    await client.query(
      `INSERT INTO "changeOrderBomChangeAssembly" (
        "bomChangeId", "assemblyItemId", quantity, "supersessionMode", "companyId", "createdBy"
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        bomChangeId,
        a.assemblyItemId,
        a.quantity,
        a.supersessionMode ?? null,
        companyId,
        userId
      ]
    );
  }
}

async function addActionTask(
  ctx: Ctx,
  changeOrderId: string,
  name: string,
  status: string,
  assignee: string | null,
  dueDate: string | null,
  sortOrder: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderActionTask" (
      "changeOrderId", name, status, assignee, "dueDate", "sortOrder", "companyId", "createdBy"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      changeOrderId,
      name,
      status,
      assignee,
      dueDate,
      sortOrder,
      companyId,
      userId
    ]
  );
}

async function addReviewer(
  ctx: Ctx,
  changeOrderId: string,
  title: string,
  assignee: string | null,
  sortOrder: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderReviewer" (
      title, "changeOrderId", status, assignee, "sortOrder", "companyId", "createdBy"
    ) VALUES ($1, $2, 'Pending', $3, $4, $5, $6)`,
    [title, changeOrderId, assignee, sortOrder, companyId, userId]
  );
}

async function addApprovalTask(
  ctx: Ctx,
  changeOrderId: string,
  assignee: string | null,
  sortOrder: number
) {
  const { client, companyId, userId } = ctx;
  await client.query(
    `INSERT INTO "changeOrderApprovalTask" (
      "changeOrderId", status, assignee, "sortOrder", "companyId", "createdBy"
    ) VALUES ($1, 'Pending', $2, $3, $4, $5)`,
    [changeOrderId, assignee, sortOrder, companyId, userId]
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  if (!process.env.SUPABASE_DB_URL) {
    console.error(
      "Error: SUPABASE_DB_URL is not set. Load it first:\n" +
        "  set -a; . ./.env.local; set +a"
    );
    process.exit(1);
  }

  const pgPool = getPostgresConnectionPool(1);
  const client = await pgPool.connect();

  try {
    const { companyId, companyName, userId, locationId, nonConformanceTypeId } =
      await resolveContext(client);

    console.log(`\nSeeding Change Orders for "${companyName}" (${companyId})`);
    console.log(`  user=${userId} location=${locationId}\n`);

    await client.query("BEGIN");

    try {
      const ctx: Ctx = { client, companyId, userId, locationId };

      // --- Idempotency: clear prior seed ---
      console.log("1. Clearing prior seed (if any)...");
      await deletePriorSeed(client, companyId);

      // --- Change order categories ---
      const cotRes = await client.query(
        `SELECT id, name FROM "changeOrderType" WHERE "companyId" = $1 AND name = ANY($2)`,
        [companyId, ["Design improvement", "Obsolescence", "Cost reduction"]]
      );
      const cotByName: Record<string, string> = {};
      for (const r of cotRes.rows) cotByName[r.name] = r.id;
      // Self-create the default categories if this company predates the
      // seed.data.ts defaults (older dev companies lack them).
      for (const name of [
        "Design improvement",
        "Obsolescence",
        "Cost reduction"
      ]) {
        if (!cotByName[name]) {
          const ins = await client.query(
            `INSERT INTO "changeOrderType" (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
            [name, companyId, userId]
          );
          cotByName[name] = ins.rows[0].id;
        }
      }
      const cotDesign = need(cotByName, "Design improvement");
      const cotObsolescence = need(cotByName, "Obsolescence");
      const cotCost = need(cotByName, "Cost reduction");

      // --- Processes ---
      console.log("2. Creating processes and work centers...");
      const processId: Record<string, string> = {};
      for (const name of PROCESS_NAMES) {
        const r = await client.query(
          `INSERT INTO process (name, "defaultStandardFactor", "companyId", "createdBy")
           VALUES ($1, 'Hours/Piece', $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        processId[name] = r.rows[0].id;
      }

      // --- Work centers ---
      const workCenterId: Record<string, string> = {};
      for (const name of WORK_CENTER_NAMES) {
        const r = await client.query(
          `INSERT INTO "workCenter" (name, "locationId", "companyId", "createdBy")
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, locationId, companyId, userId]
        );
        workCenterId[name] = r.rows[0].id;
      }

      // --- Suppliers / customers ---
      console.log("3. Creating suppliers and customers...");
      const supplierId: Record<string, string> = {};
      for (const name of SUPPLIER_NAMES) {
        const r = await client.query(
          `INSERT INTO supplier (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        supplierId[name] = r.rows[0].id;
      }
      const customerId: Record<string, string> = {};
      for (const name of CUSTOMER_NAMES) {
        const r = await client.query(
          `INSERT INTO customer (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
          [name, companyId, userId]
        );
        customerId[name] = r.rows[0].id;
      }

      // --- Purchased items (keyed by readableId + '.' + revision) ---
      console.log("4. Creating purchased parts...");
      const purchased: Record<string, string> = {};
      for (const def of PURCHASED_PARTS) {
        const key = `${def.readableId}.${def.revision}`;
        purchased[key] = await createPurchasedItem(ctx, def);
      }
      // Convenience references.
      const bracketA = need(purchased, "PRT-001186.0"); // ".A"
      const bracketB = need(purchased, "PRT-001186.B"); // ".B"
      const fst100 = need(purchased, "FST-100.0");
      const fst101 = need(purchased, "FST-101.0");
      const fst102 = need(purchased, "FST-102.0");
      const brg200 = need(purchased, "BRG-200.0");
      const cbl300 = need(purchased, "CBL-300.0");

      // --- Make items with BOM + BOP ---
      console.log("5. Creating make parts with BOM + BOP...");
      const make: Record<string, { itemId: string; makeMethodId: string }> = {};
      for (const def of MAKE_PARTS) {
        make[def.readableId] = await createMakeItem(ctx, def);
      }
      const ga0020 = need(make, "GA-0020");
      const ga0022 = need(make, "GA-0022");
      const ga0044 = need(make, "GA-0044");
      const sa0065 = need(make, "SA-0065");
      const veh1 = need(make, "VEH0000001");
      const veh6 = need(make, "VEH000006");

      // BOMs
      await addBomLine(ctx, ga0020.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0020.makeMethodId, fst100, 4, 2);
      await addBomLine(ctx, ga0020.makeMethodId, brg200, 2, 3);
      await addBopOperation(
        ctx,
        ga0020.makeMethodId,
        need(processId, "Machining"),
        need(workCenterId, "CNC Mill"),
        "Machining",
        1
      );
      await addBopOperation(
        ctx,
        ga0020.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        2
      );

      await addBomLine(ctx, ga0022.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0022.makeMethodId, fst100, 2, 2);
      await addBopOperation(
        ctx,
        ga0022.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      await addBomLine(ctx, ga0044.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, ga0044.makeMethodId, cbl300, 1, 2);
      await addBopOperation(
        ctx,
        ga0044.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      await addBomLine(ctx, sa0065.makeMethodId, bracketA, 1, 1);
      await addBomLine(ctx, sa0065.makeMethodId, fst101, 1, 2);
      await addBopOperation(
        ctx,
        sa0065.makeMethodId,
        need(processId, "Welding"),
        need(workCenterId, "Weld Cell"),
        "Welding",
        1
      );
      await addBopOperation(
        ctx,
        sa0065.makeMethodId,
        need(processId, "Inspection"),
        need(workCenterId, "QC Bench"),
        "Inspection",
        2
      );

      await addBomLine(ctx, veh1.makeMethodId, ga0020.itemId, 1, 1);
      await addBomLine(ctx, veh1.makeMethodId, ga0022.itemId, 1, 2);
      await addBomLine(ctx, veh1.makeMethodId, sa0065.itemId, 1, 3);
      await addBopOperation(
        ctx,
        veh1.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );
      await addBopOperation(
        ctx,
        veh1.makeMethodId,
        need(processId, "Inspection"),
        need(workCenterId, "QC Bench"),
        "Inspection",
        2
      );

      await addBomLine(ctx, veh6.makeMethodId, sa0065.itemId, 1, 1);
      await addBomLine(ctx, veh6.makeMethodId, ga0044.itemId, 1, 2);
      await addBopOperation(
        ctx,
        veh6.makeMethodId,
        need(processId, "Assembly"),
        need(workCenterId, "Assembly Line 1"),
        "Assembly",
        1
      );

      // --- Downstream: PO, Job, Sales Order ---
      console.log("6. Creating downstream PO / Job / Sales Order...");

      // Open PO for PRT-001186.A (drives Implementation impact panel)
      const siRes = await client.query(
        `INSERT INTO "supplierInteraction" ("companyId", "supplierId") VALUES ($1, $2) RETURNING id`,
        [companyId, need(supplierId, "FastenerCo")]
      );
      const supplierInteractionId = siRes.rows[0].id;
      const poRes = await client.query(
        `INSERT INTO "purchaseOrder" (
          "purchaseOrderId", "supplierId", "supplierInteractionId", status,
          "purchaseOrderType", "exchangeRate", "companyId", "createdBy"
        ) VALUES ($1, $2, $3, 'To Receive', 'Purchase', 1, $4, $5) RETURNING id`,
        [
          PO_ID,
          need(supplierId, "FastenerCo"),
          supplierInteractionId,
          companyId,
          userId
        ]
      );
      const purchaseOrderId = poRes.rows[0].id;
      await client.query(
        `INSERT INTO "purchaseOrderDelivery" (id, "locationId", "companyId") VALUES ($1, $2, $3)`,
        [purchaseOrderId, locationId, companyId]
      );
      await client.query(
        `INSERT INTO "purchaseOrderLine" (
          "purchaseOrderId", "purchaseOrderLineType", "itemId",
          "purchaseQuantity", "quantityReceived", "quantityInvoiced",
          "supplierUnitPrice", "supplierShippingCost", "supplierTaxAmount",
          "exchangeRate", "setupPrice", "conversionFactor",
          "purchaseUnitOfMeasureCode", "inventoryUnitOfMeasureCode",
          "companyId", "createdBy"
        ) VALUES ($1, 'Part', $2, 200, 0, 0, 12.50, 0, 0, 1, 0, 1, 'EA', 'EA', $3, $4)`,
        [purchaseOrderId, bracketA, companyId, userId]
      );

      // In-progress job for VEH0000001
      await client.query(
        `INSERT INTO job (
          "jobId", "itemId", quantity, "locationId", status, "unitOfMeasureCode", "companyId", "createdBy"
        ) VALUES ($1, $2, 5, $3, 'In Progress', 'EA', $4, $5)`,
        [JOB_ID, veh1.itemId, locationId, companyId, userId]
      );

      // Sales order (To Ship) for VEH0000001
      const soRes = await client.query(
        `INSERT INTO "salesOrder" (
          "salesOrderId", "customerId", "currencyCode", status, "companyId", "createdBy"
        ) VALUES ($1, $2, 'USD', 'To Ship', $3, $4) RETURNING id`,
        [SO_ID, need(customerId, "VeloRetail"), companyId, userId]
      );
      const salesOrderId = soRes.rows[0].id;
      await client.query(
        `INSERT INTO "salesOrderShipment" (id, "locationId", "companyId") VALUES ($1, $2, $3)`,
        [salesOrderId, locationId, companyId]
      );
      await client.query(
        `INSERT INTO "salesOrderLine" (
          "salesOrderId", "salesOrderLineType", "itemId",
          "saleQuantity", "unitPrice", "unitOfMeasureCode", "companyId", "createdBy"
        ) VALUES ($1, 'Part', $2, 5, 899.00, 'EA', $3, $4)`,
        [salesOrderId, veh1.itemId, companyId, userId]
      );

      // --- NCR (linked from CO-000001) ---
      console.log("7. Creating NCR...");
      const ncrRes = await client.query(
        `INSERT INTO "nonConformance" (
          "nonConformanceId", name, source, "locationId", "nonConformanceTypeId",
          "openDate", "companyId", "createdBy"
        ) VALUES ($1, $2, 'Internal', $3, $4, $5, $6, $7) RETURNING id`,
        [
          NCR_ID,
          "Derailleur thread failure under load",
          locationId,
          nonConformanceTypeId,
          "2026-07-05",
          companyId,
          userId
        ]
      );
      const ncrId = ncrRes.rows[0].id;

      // --- Change orders ---
      console.log("8. Creating change orders...");

      // CO-000001 — Implementation
      const co1 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000001",
        name: "Sync 3 Derailleur Mount",
        status: "Implementation",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        effectiveDate: "2026-07-15",
        reasonForChange:
          "Field returns show the derailleur mount thread fails under sustained load. " +
          "Root-caused to the Rear Dropout Bracket geometry (see NCR-CO-001).",
        description:
          "Supersede Rear Dropout Bracket (PRT-001186.A) with the redesigned " +
          "PRT-001186.B across all affected assemblies. New CAD released via Onshape.",
        nonConformanceId: ncrId
      });
      await addProductAffected(ctx, co1, veh1.itemId);
      await addProductAffected(ctx, co1, veh6.itemId);
      // Delete PRT-001186.A across 4 assemblies (modes vary per assembly)
      await addBomChange(ctx, co1, "Delete", bracketA, 1, [
        { assemblyItemId: ga0020.itemId, quantity: 1, supersessionMode: null },
        {
          assemblyItemId: ga0022.itemId,
          quantity: 1,
          supersessionMode: "Prefer New"
        },
        { assemblyItemId: ga0044.itemId, quantity: 1, supersessionMode: null },
        { assemblyItemId: sa0065.itemId, quantity: 1, supersessionMode: null }
      ]);
      // Add PRT-001186.B to the same 4 assemblies
      await addBomChange(ctx, co1, "Add", bracketB, 2, [
        { assemblyItemId: ga0020.itemId, quantity: 1 },
        { assemblyItemId: ga0022.itemId, quantity: 1 },
        { assemblyItemId: ga0044.itemId, quantity: 1 },
        { assemblyItemId: sa0065.itemId, quantity: 1 }
      ]);
      await addActionTask(
        ctx,
        co1,
        "Submit PRT-001186.B CAD for Onshape approval",
        "Completed",
        userId,
        null,
        1
      );
      await addActionTask(
        ctx,
        co1,
        "Update work instruction WI-0089",
        "Pending",
        null,
        "2026-07-20",
        2
      );

      // CO-000002 — Engineering Complete
      const co2 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000002",
        name: "VEH3 Battery Lock Update",
        status: "Engineering Complete",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Battery lock rattle under vibration; replace fastener with a sealed bearing detent.",
        description:
          "Remove M5 Bolt from Stage 3 and add a Sealed Bearing detent."
      });
      await addProductAffected(ctx, co2, veh1.itemId);
      await addBomChange(ctx, co2, "Delete", fst100, 1, [
        {
          assemblyItemId: ga0022.itemId,
          quantity: 1,
          supersessionMode: "Consume First"
        }
      ]);
      await addBomChange(ctx, co2, "Add", brg200, 2, [
        { assemblyItemId: ga0022.itemId, quantity: 1 }
      ]);

      // CO-000003 — Start
      const co3 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000003",
        name: "Cargo Box Bracket Redesign",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Cargo box bracket alignment dowel is over-specified; remove to reduce cost and weight.",
        description: "Delete Alignment Dowel from Pedal2 Sync3 sub-assembly."
      });
      await addProductAffected(ctx, co3, veh6.itemId);
      await addBomChange(ctx, co3, "Delete", fst101, 1, [
        {
          assemblyItemId: sa0065.itemId,
          quantity: 1,
          supersessionMode: "Stock Only"
        }
      ]);

      // CO-000004 — Start
      const co4 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000004",
        name: "V18 Frame Cable Routing",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Internal cable routing eliminates the external cable housing.",
        description: "Delete Cable Housing from the Stage 2 Alt gear assembly."
      });
      await addBomChange(ctx, co4, "Delete", cbl300, 1, [
        {
          assemblyItemId: ga0044.itemId,
          quantity: 1,
          supersessionMode: "No Stock"
        }
      ]);
      await addActionTask(
        ctx,
        co4,
        "Reroute cable channel",
        "In Progress",
        userId,
        null,
        1
      );

      // CO-000005 — Done (already-applied CO)
      const co5 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000005",
        name: "Saddle Supersession Royal MW",
        status: "Done",
        changeOrderTypeId: cotObsolescence,
        assignee: userId,
        effectiveDate: "2026-06-01",
        reasonForChange:
          "Original saddle supplier discontinued the SKU; superseded by Royal MW.",
        description:
          "Obsolescence supersession applied across affected vehicles."
      });
      await addProductAffected(ctx, co5, veh6.itemId);
      await addActionTask(
        ctx,
        co5,
        "Confirm inventory drawdown of obsolete saddle",
        "Completed",
        userId,
        null,
        1
      );

      // CO-000006 — Draft (Unassigned, blank)
      await createChangeOrder(ctx, {
        changeOrderId: "CO-000006",
        name: "Luxembourg Handlebar Stem",
        status: "Draft",
        changeOrderTypeId: cotCost,
        assignee: null
      });

      // CO-000007 — Start, with approval flow
      const co7 = await createChangeOrder(ctx, {
        changeOrderId: "CO-000007",
        name: "Fork Crown Reinforcement",
        status: "Start",
        changeOrderTypeId: cotDesign,
        assignee: userId,
        reasonForChange:
          "Add a locking washer to the fork crown assembly to prevent loosening.",
        description:
          "Add Locking Washer (FST-102) x2 to the Stage 2 gear assembly."
      });
      await addProductAffected(ctx, co7, veh1.itemId);
      // Add FST-102 (distinct free part — resolves the FST-101 single-open-CO overlap)
      await addBomChange(ctx, co7, "Add", fst102, 1, [
        { assemblyItemId: ga0020.itemId, quantity: 2 }
      ]);
      await addReviewer(ctx, co7, "Design Review", userId, 1);
      await addReviewer(ctx, co7, "Manufacturing Review", userId, 2);
      await addApprovalTask(ctx, co7, userId, 1);

      // --- Bump the CO sequence past the seeded ids ---
      console.log("9. Bumping changeOrder sequence...");
      await client.query(
        `UPDATE sequence SET next = 8 WHERE "table" = 'changeOrder' AND "companyId" = $1 AND next < 8`,
        [companyId]
      );

      await client.query("COMMIT");
      console.log("   Transaction committed successfully.\n");

      await printSummary(client, companyId);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("   Transaction rolled back due to error.");
      throw err;
    }
  } catch (error) {
    console.error("\nError seeding change orders:");
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
async function printSummary(client: PoolClient, companyId: string) {
  const q = async (sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows;

  const items = await q(
    `SELECT count(*)::int n FROM item WHERE "companyId" = $1 AND "readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const makeMethods = await q(
    `SELECT count(*)::int n FROM "makeMethod" mk JOIN item i ON i.id = mk."itemId"
     WHERE i."companyId" = $1 AND i."readableId" = ANY($2) AND mk.status = 'Active'`,
    [companyId, MAKE_PARTS.map((p) => p.readableId)]
  );
  const bomLines = await q(
    `SELECT count(*)::int n FROM "methodMaterial" mm JOIN "makeMethod" mk ON mk.id = mm."makeMethodId"
     JOIN item i ON i.id = mk."itemId" WHERE i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const bopOps = await q(
    `SELECT count(*)::int n FROM "methodOperation" mo JOIN "makeMethod" mk ON mk.id = mo."makeMethodId"
     JOIN item i ON i.id = mk."itemId" WHERE i."companyId" = $1 AND i."readableId" = ANY($2)`,
    [companyId, ALL_SEEDED_ITEM_IDS]
  );
  const cosByStatus = await q(
    `SELECT status, count(*)::int n FROM "changeOrder"
     WHERE "companyId" = $1 AND "changeOrderId" = ANY($2) GROUP BY status ORDER BY status`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const productsAffected = await q(
    `SELECT count(*)::int n FROM "changeOrderProductAffected" pa
     JOIN "changeOrder" co ON co.id = pa."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const bomChanges = await q(
    `SELECT count(*)::int n FROM "changeOrderBomChange" bc
     JOIN "changeOrder" co ON co.id = bc."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const assemblies = await q(
    `SELECT count(*)::int n FROM "changeOrderBomChangeAssembly" a
     JOIN "changeOrderBomChange" bc ON bc.id = a."bomChangeId"
     JOIN "changeOrder" co ON co.id = bc."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const actions = await q(
    `SELECT count(*)::int n FROM "changeOrderActionTask" t
     JOIN "changeOrder" co ON co.id = t."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const reviewers = await q(
    `SELECT count(*)::int n FROM "changeOrderReviewer" r
     JOIN "changeOrder" co ON co.id = r."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const approvals = await q(
    `SELECT count(*)::int n FROM "changeOrderApprovalTask" ap
     JOIN "changeOrder" co ON co.id = ap."changeOrderId"
     WHERE co."companyId" = $1 AND co."changeOrderId" = ANY($2)`,
    [companyId, CHANGE_ORDER_IDS]
  );
  const ncrs = await q(
    `SELECT count(*)::int n FROM "nonConformance" WHERE "companyId" = $1 AND "nonConformanceId" = $2`,
    [companyId, NCR_ID]
  );

  console.log("========================================");
  console.log("Change Orders seed summary");
  console.log("========================================");
  console.log(`  Items:            ${items[0].n} (7 purchased + 6 make)`);
  console.log(`  Active makeMethods: ${makeMethods[0].n}`);
  console.log(`  BOM lines:        ${bomLines[0].n}`);
  console.log(`  BOP operations:   ${bopOps[0].n}`);
  console.log(
    `  Suppliers/Customers: ${SUPPLIER_NAMES.length}/${CUSTOMER_NAMES.length}`
  );
  console.log(`  Purchase Order:   ${PO_ID} (To Receive, PRT-001186.A x200)`);
  console.log(`  Job:              ${JOB_ID} (In Progress, VEH0000001)`);
  console.log(`  Sales Order:      ${SO_ID} (To Ship, VEH0000001)`);
  console.log(`  NCR:              ${ncrs[0].n > 0 ? NCR_ID : "MISSING"}`);
  console.log("  Change Orders by status:");
  for (const r of cosByStatus) console.log(`    ${r.status.padEnd(22)} ${r.n}`);
  console.log(`  Products Affected rows: ${productsAffected[0].n}`);
  console.log(`  BOM change rows:        ${bomChanges[0].n}`);
  console.log(`  BOM change assemblies:  ${assemblies[0].n}`);
  console.log(`  Action tasks:           ${actions[0].n}`);
  console.log(`  Reviewers:              ${reviewers[0].n}`);
  console.log(`  Approval tasks:         ${approvals[0].n}`);
  console.log("========================================\n");
}

seed();
