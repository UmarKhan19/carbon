import { createHash, createHmac, randomBytes } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

type ApiResult = { status: number; body: unknown };

type FixtureIds = {
  companies: string[];
  notices: string[];
  decisions: string[];
  provenance: string[];
  history: string[];
  tasks: string[];
  links: Array<[string, string, string]>;
  apiKeys: string[];
  employeeMemberships: Array<[string, string]>;
};

const testDirectory = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  loadDotenv({ path: resolve(testDirectory, "../../../..", ".env.local") });
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_DB_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_JWT_SECRET) {
    throw new Error("Expected Carbon Supabase environment in process.env or .env.local");
  }
  return env as {
    SUPABASE_URL: string;
    SUPABASE_DB_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_JWT_SECRET: string;
  };
}

const env = loadEnv();
const apiBase = env.SUPABASE_URL.replace(/\/$/, "");
const userId = "system";
const prefix = `impact-rls-${randomBytes(12).toString("hex")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function request(
  key: string,
  table: string,
  method: string,
  query = "",
  body?: Record<string, unknown>
): Promise<ApiResult> {
  const response = await fetch(`${apiBase}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "carbon-key": key,
      "content-type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

function rows(result: ApiResult): unknown[] {
  return Array.isArray(result.body) ? result.body : [];
}

function assert(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    throw new Error(`${name}: ${detail ? JSON.stringify(detail) : "assertion failed"}`);
  }
  console.log(`PASS ${name}`);
}

function isDenied(result: ApiResult): boolean {
  return (result.status >= 400 && result.status < 500) ||
    (result.status === 200 && rows(result).length === 0);
}

function hasNoVisibleMutation(result: ApiResult): boolean {
  return result.status >= 400 || rows(result).length === 0;
}

// Mirrors Carbon's getUserScopedClient JWT claims without importing the full app
// environment (which requires unrelated ERP secrets in this DB package test).
function getEmployeeJwt(userId: string): string {
  const encode = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, aud: "authenticated", role: "authenticated" });
  const signature = createHmac("sha256", env.SUPABASE_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function employeeRequest(
  jwt: string,
  table: string,
  method: string,
  query = "",
  body?: Record<string, unknown>
): Promise<ApiResult> {
  const response = await fetch(`${apiBase}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

type EmployeePermissionOverrides = {
  partsView: boolean;
  partsUpdate: boolean;
  purchasingView: boolean;
  productionView: boolean;
};

async function setEmployeePermissions(
  db: Client,
  userId: string,
  companyId: string | string[],
  overrides: EmployeePermissionOverrides
): Promise<void> {
  const companyIds = Array.isArray(companyId) ? companyId : [companyId];
  await db.query(
    `UPDATE "userPermission"
     SET "permissions" = "permissions" || $1::jsonb
     WHERE "id" = $2`,
    [
      JSON.stringify({
        parts_view: overrides.partsView ? companyIds : [],
        parts_update: overrides.partsUpdate ? companyIds : [],
        purchasing_view: overrides.purchasingView ? companyIds : [],
        production_view: overrides.productionView ? companyIds : []
      }),
      userId
    ]
  );
}

async function runEmployeeSessionChecks(
  db: Client,
  companyId: string,
  userId: string,
  noticeId: string,
  poDecisionId: string,
  jobDecisionId: string,
  materialDecisionId: string,
  taskId: string
): Promise<void> {
  const employeeJwt = getEmployeeJwt(userId);
  const decision = (id: string) => `?id=eq.${encodeURIComponent(id)}&select=id`;

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: true,
    productionView: false
  });
  let read = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(poDecisionId));
  assert("Employee PO parts_view + purchasing_view can read", read.status === 200 && rows(read).length === 1);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: false
  });
  read = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(poDecisionId));
  assert("Employee PO without purchasing_view cannot read", read.status === 200 && rows(read).length === 0);

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: true
  });
  const jobRead = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(jobDecisionId));
  const materialRead = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "GET",
    decision(materialDecisionId)
  );
  assert("Employee Job parts_view + production_view can read", jobRead.status === 200 && rows(jobRead).length === 1);
  assert(
    "Employee Job Material production visibility can read",
    materialRead.status === 200 && rows(materialRead).length === 1
  );

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: false,
    purchasingView: false,
    productionView: false
  });
  const hiddenJob = await employeeRequest(employeeJwt, "changeOrderImpactDecision", "GET", decision(jobDecisionId));
  const hiddenMaterial = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "GET",
    decision(materialDecisionId)
  );
  assert("Employee Job without production_view cannot read", hiddenJob.status === 200 && rows(hiddenJob).length === 0);
  assert(
    "Employee Job Material without production_view cannot read",
    hiddenMaterial.status === 200 && rows(hiddenMaterial).length === 0
  );

  await setEmployeePermissions(db, userId, companyId, {
    partsView: true,
    partsUpdate: true,
    purchasingView: true,
    productionView: true
  });
  const employeeInsertTargetId = `employee-direct-${randomBytes(8).toString("hex")}`;
  const directInsert = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "POST",
    "",
    {
      companyId,
      changeNoticeId: noticeId,
      targetType: "purchaseOrderLine",
      targetId: employeeInsertTargetId,
      decisionStatus: "Action required",
      assessmentSnapshot: {},
      assessedBy: userId,
      createdBy: userId
    }
  );
  const employeeDirectDecisionCount = (
    await db.query(
      `SELECT count(*)::int AS count FROM "changeOrderImpactDecision"
       WHERE "companyId" = $1 AND "targetId" = $2`,
      [companyId, employeeInsertTargetId]
    )
  ).rows[0].count;
  assert(
    "Employee direct Impact INSERT is denied",
    hasNoVisibleMutation(directInsert) && employeeDirectDecisionCount === 0
  );

  const beforeDecision = (
    await db.query(
      `SELECT "decisionStatus", "revision" FROM "changeOrderImpactDecision" WHERE "id" = $1`,
      [poDecisionId]
    )
  ).rows[0];
  const directUpdate = await employeeRequest(
    employeeJwt,
    "changeOrderImpactDecision",
    "PATCH",
    `?id=eq.${encodeURIComponent(poDecisionId)}`,
    { decisionStatus: "Resolved", revision: 99 }
  );
  const afterDecision = (
    await db.query(
      `SELECT "decisionStatus", "revision" FROM "changeOrderImpactDecision" WHERE "id" = $1`,
      [poDecisionId]
    )
  ).rows[0];
  assert(
    "Employee direct Impact UPDATE is denied",
    hasNoVisibleMutation(directUpdate) &&
      afterDecision.decisionStatus === beforeDecision.decisionStatus &&
      afterDecision.revision === beforeDecision.revision
  );

  const directOrigin = await employeeRequest(
    employeeJwt,
    "changeOrderActionTask",
    "PATCH",
    `?id=eq.${encodeURIComponent(taskId)}`,
    { taskOrigin: "Impact follow-up" }
  );
  const originAfterDirectPromotion = (
    await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [taskId])
  ).rows[0].taskOrigin;
  assert("Employee direct taskOrigin promotion is denied", directOrigin.status >= 400 && originAfterDirectPromotion === "Manual");

  const ordinaryTaskUpdate = await employeeRequest(
    employeeJwt,
    "changeOrderActionTask",
    "PATCH",
    `?id=eq.${encodeURIComponent(taskId)}`,
    { name: "Employee ordinary task update" }
  );
  const ordinaryTaskAfterUpdate = (
    await db.query(`SELECT "name", "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [taskId])
  ).rows[0];
  assert(
    "Employee ordinary task update remains allowed",
    ordinaryTaskUpdate.status === 200 &&
      rows(ordinaryTaskUpdate).length === 1 &&
      ordinaryTaskAfterUpdate.name === "Employee ordinary task update" &&
      ordinaryTaskAfterUpdate.taskOrigin === "Manual"
  );
}

async function insertApiKey(
  db: Client,
  fixture: FixtureIds,
  name: string,
  companyId: string,
  scopes: Record<string, string[]>
): Promise<string> {
  const raw = `${prefix}-${name}-${randomBytes(12).toString("hex")}`;
  const result = await db.query(
    `INSERT INTO "apiKey" ("name", "companyId", "createdBy", "keyHash", "keyPreview", "scopes")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING "id"`,
    [name, companyId, userId, hash(raw), raw.slice(-8), JSON.stringify(scopes)]
  );
  fixture.apiKeys.push(result.rows[0].id);
  return raw;
}

async function insertNotice(db: Client, companyId: string, name: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrder" ("changeOrderId", "name", "openDate", "companyId", "createdBy")
     VALUES ($1, $2, CURRENT_DATE, $3, $4)
     RETURNING "id"`,
    [`${prefix}-${name}`, name, companyId, userId]
  );
  return result.rows[0].id;
}

async function insertTask(
  db: Client,
  companyId: string,
  noticeId: string,
  name: string
): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrderActionTask" ("changeOrderId", "name", "companyId", "createdBy")
     VALUES ($1, $2, $3, $4)
     RETURNING "id"`,
    [noticeId, name, companyId, userId]
  );
  return result.rows[0].id;
}

async function insertDecision(
  db: Client,
  fixture: FixtureIds,
  companyId: string,
  noticeId: string,
  targetType: string,
  targetId: string
): Promise<string> {
  const result = await db.query(
    `INSERT INTO "changeOrderImpactDecision"
      ("companyId", "changeNoticeId", "targetType", "targetId", "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy")
     VALUES ($1, $2, $3, $4, 'Action required', '{}'::jsonb, $5, $5)
     RETURNING "id"`,
    [companyId, noticeId, targetType, targetId, userId]
  );
  fixture.decisions.push(result.rows[0].id);
  return result.rows[0].id;
}

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL });
  const fixture: FixtureIds = {
    companies: [],
    notices: [],
    decisions: [],
    provenance: [],
    history: [],
    tasks: [],
    links: [],
    apiKeys: [],
    employeeMemberships: []
  };
  let employeeUserId = "";
  let employeeOriginalPermissions: unknown;
  await db.connect();

  try {
    const company = (
      await db.query(`SELECT "id" FROM "company" ORDER BY "createdAt" LIMIT 1`)
    ).rows[0]?.id;
    if (!company) throw new Error("local DB needs a company fixture");
    const employee = (
      await db.query(
        `SELECT utc."userId", up."permissions"
         FROM "userToCompany" utc
         JOIN "userPermission" up ON up."id" = utc."userId"
         WHERE utc."companyId" = $1 AND utc."role" = 'employee'
         LIMIT 1`,
        [company]
      )
    ).rows[0];
    if (!employee) throw new Error("local DB needs an authenticated employee fixture");
    employeeUserId = employee.userId;
    employeeOriginalPermissions = employee.permissions;
    const notice = await insertNotice(db, company, `${prefix}-primary-notice`);
    fixture.notices.push(notice);

    const poDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "purchaseOrderLine",
      `${prefix}-po`
    );
    const jobDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "job",
      `${prefix}-job`
    );
    const materialDecision = await insertDecision(
      db,
      fixture,
      company,
      notice,
      "jobMaterial",
      `${prefix}-material`
    );

    for (const [decisionId, sourceId] of [
      [poDecision, `${prefix}-po`],
      [jobDecision, `${prefix}-job`],
      [materialDecision, `${prefix}-material`]
    ]) {
      const provenance = await db.query(
        `INSERT INTO "changeOrderImpactDecisionAffectedItem"
          ("companyId", "decisionId", "affectedItemId", "affectedItemSourceId", "affectedItemLabel", "startedBy", "createdBy")
         VALUES ($1, $2, $3, $3, 'RLS fixture', $4, $4)
         RETURNING "id"`,
        [company, decisionId, `${prefix}-${sourceId}`, userId]
      );
      fixture.provenance.push(provenance.rows[0].id);
      const history = await db.query(
        `INSERT INTO "changeOrderImpactDecisionHistory"
          ("companyId", "decisionId", "targetType", "targetId", "eventType", "newStatus", "newSnapshot", "createdBy")
         SELECT $1, id, "targetType", "targetId", 'Decision created', "decisionStatus", '{}'::jsonb, $3
         FROM "changeOrderImpactDecision" WHERE id = $2
         RETURNING "id"`,
        [company, decisionId, userId]
      );
      fixture.history.push(history.rows[0].id);
    }

    const task = await insertTask(db, company, notice, `${prefix}-task`);
    fixture.tasks.push(task);
    const sameNoticeTask = await insertTask(db, company, notice, `${prefix}-same-notice-task`);
    fixture.tasks.push(sameNoticeTask);
    await db.query(
      `INSERT INTO "changeOrderImpactDecisionActionTask" ("decisionId", "actionTaskId", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4)`,
      [poDecision, task, company, userId]
    );
    fixture.links.push([poDecision, task, company]);

    const otherNotice = await insertNotice(db, company, `${prefix}-other-notice`);
    fixture.notices.push(otherNotice);
    const otherTask = await insertTask(db, company, otherNotice, `${prefix}-other-task`);
    fixture.tasks.push(otherTask);

    const currency = (
      await db.query(`SELECT "code" FROM "currencyCode" LIMIT 1`)
    ).rows[0]?.code;
    if (!currency) throw new Error("local DB needs a currency fixture");
    const otherCompany = (
      await db.query(
        `INSERT INTO "company" ("name", "baseCurrencyCode") VALUES ($1, $2) RETURNING "id"`,
        [`${prefix}-other-company`, currency]
      )
    ).rows[0].id;
    fixture.companies.push(otherCompany);
    await db.query(
      `INSERT INTO "userToCompany" ("userId", "companyId", "role")
       VALUES ($1, $2, 'employee')`,
      [employeeUserId, otherCompany]
    );
    fixture.employeeMemberships.push([employeeUserId, otherCompany]);
    const otherCompanyNotice = await insertNotice(
      db,
      otherCompany,
      `${prefix}-other-company-notice`
    );
    fixture.notices.push(otherCompanyNotice);
    const otherCompanyTask = await insertTask(
      db,
      otherCompany,
      otherCompanyNotice,
      `${prefix}-other-company-task`
    );
    fixture.tasks.push(otherCompanyTask);
    const otherCompanyDecision = await insertDecision(
      db,
      fixture,
      otherCompany,
      otherCompanyNotice,
      "purchaseOrderLine",
      `${prefix}-other-company-po`
    );
    const sharedDecisionId = `${prefix}-shared-decision`;
    await db.query(
      `INSERT INTO "changeOrderImpactDecision"
        ("id", "companyId", "changeNoticeId", "targetType", "targetId", "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy")
       VALUES
        ($1, $2, $3, 'purchaseOrderLine', $4, 'Action required', '{}'::jsonb, $8, $8),
        ($1, $5, $6, 'job', $7, 'Action required', '{}'::jsonb, $8, $8)`,
      [
        sharedDecisionId,
        company,
        notice,
        `${prefix}-shared-po`,
        otherCompany,
        otherCompanyNotice,
        `${prefix}-shared-job`,
        userId
      ]
    );
    fixture.decisions.push(sharedDecisionId);
    const sharedProvenance = await db.query(
      `INSERT INTO "changeOrderImpactDecisionAffectedItem"
        ("companyId", "decisionId", "affectedItemId", "affectedItemSourceId", "affectedItemLabel", "startedBy", "createdBy")
       VALUES ($1, $2, $3, $3, 'Shared Company A provenance', $4, $4)
       RETURNING "id"`,
      [company, sharedDecisionId, `${prefix}-shared-affected-item`, userId]
    );
    fixture.provenance.push(sharedProvenance.rows[0].id);
    const sharedHistory = await db.query(
      `INSERT INTO "changeOrderImpactDecisionHistory"
        ("companyId", "decisionId", "targetType", "targetId", "eventType", "newStatus", "newSnapshot", "createdBy")
       SELECT $1, "id", "targetType", "targetId", 'Decision created', "decisionStatus", '{}'::jsonb, $3
       FROM "changeOrderImpactDecision"
       WHERE "id" = $2 AND "companyId" = $1
       RETURNING "id"`,
      [company, sharedDecisionId, userId]
    );
    fixture.history.push(sharedHistory.rows[0].id);

    const partsOnly = await insertApiKey(db, fixture, "parts-only", company, {
      parts_view: [company]
    });
    const poRead = await insertApiKey(db, fixture, "po-read", company, {
      parts_view: [company],
      purchasing_view: [company]
    });
    const productionRead = await insertApiKey(db, fixture, "production-read", company, {
      parts_view: [company],
      production_view: [company]
    });
    const noPartsUpdate = await insertApiKey(db, fixture, "no-parts-update", company, {
      parts_view: [company],
      purchasing_view: [company]
    });
    const noSourceView = await insertApiKey(db, fixture, "no-source-view", company, {
      parts_view: [company],
      parts_update: [company]
    });
    const full = await insertApiKey(db, fixture, "full", company, {
      parts_view: [company],
      parts_update: [company],
      purchasing_view: [company]
    });
    const taskWriter = await insertApiKey(db, fixture, "task-writer", company, {
      parts_view: [company],
      parts_create: [company],
      parts_update: [company],
      purchasing_view: [company]
    });

    await db.query(
      `UPDATE "changeOrderActionTask" SET "taskOrigin" = 'Impact follow-up' WHERE "id" = $1`,
      [task]
    );
    const trustedOrigin = (
      await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [task])
    ).rows[0]?.taskOrigin;
    assert("Trusted database path can set taskOrigin", trustedOrigin === "Impact follow-up");
    await db.query(`UPDATE "changeOrderActionTask" SET "taskOrigin" = 'Manual' WHERE "id" = $1`, [task]);

    const row = (targetType: string, targetId: string) =>
      `?targetType=eq.${targetType}&targetId=eq.${encodeURIComponent(targetId)}`;
    let result = await request(
      partsOnly,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("PO with parts_view only is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      poRead,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("PO with purchasing_view is readable", result.status === 200 && rows(result).length === 1);
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionActionTask",
      "changeOrderImpactDecisionHistory"
    ]) {
      result = await request(partsOnly, table, "GET");
      assert(`${table} with parts_view only is hidden`, result.status === 200 && rows(result).length === 0);
      result = await request(poRead, table, "GET");
      assert(`${table} with purchasing_view is readable`, result.status === 200 && rows(result).length > 0);
    }
    result = await request(
      partsOnly,
      "changeOrderImpactDecision",
      "GET",
      row("job", `${prefix}-job`)
    );
    assert("Job with parts_view only is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("job", `${prefix}-job`)
    );
    assert("Job with production_view is readable", result.status === 200 && rows(result).length === 1);
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("jobMaterial", `${prefix}-material`)
    );
    assert("Job Material with production_view is readable", result.status === 200 && rows(result).length === 1);
    for (const table of [
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionHistory"
    ]) {
      result = await request(productionRead, table, "GET");
      assert(`${table} with production_view is readable`, result.status === 200 && rows(result).length > 0);
    }
    result = await request(productionRead, "changeOrderImpactDecisionActionTask", "GET");
    assert("Task links do not reveal PO links to production-only users", result.status === 200 && rows(result).length === 0);
    result = await request(
      productionRead,
      "changeOrderImpactDecision",
      "GET",
      row("purchaseOrderLine", `${prefix}-po`)
    );
    assert("Production-only source view cannot read PO", result.status === 200 && rows(result).length === 0);

    const body = {
      companyId: company,
      changeNoticeId: notice,
      targetType: "purchaseOrderLine",
      targetId: `${prefix}-write`,
      decisionStatus: "Action required",
      assessmentSnapshot: {},
      assessedBy: userId,
      createdBy: userId
    };
    result = await request(noPartsUpdate, "changeOrderImpactDecision", "POST", "", body);
    assert("Missing parts_update blocks Impact INSERT", isDenied(result));
    result = await request(noSourceView, "changeOrderImpactDecision", "POST", "", body);
    assert("Missing source view blocks Impact INSERT", isDenied(result));
    result = await request(full, "changeOrderImpactDecision", "POST", "", body);
    const directDecisionCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecision"
         WHERE "companyId" = $1 AND "targetId" = $2`,
        [company, body.targetId]
      )
    ).rows[0].count;
    assert("Source-authorized direct Impact INSERT is denied", hasNoVisibleMutation(result) && directDecisionCount === 0);
    result = await request(
      full,
      "changeOrderImpactDecision",
      "GET",
      `?companyId=eq.${encodeURIComponent(otherCompany)}&id=eq.${encodeURIComponent(otherCompanyDecision)}`
    );
    assert("Wrong-company Impact read is hidden", result.status === 200 && rows(result).length === 0);
    result = await request(
      full,
      "changeOrderImpactDecision",
      "POST",
      "",
      { ...body, companyId: otherCompany, changeNoticeId: otherCompanyNotice }
    );
    assert("Wrong-company Impact INSERT is blocked", isDenied(result));

    result = await request(
      noPartsUpdate,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      { rationale: "blocked" }
    );
    assert("Missing parts_update blocks Impact UPDATE", isDenied(result));
    result = await request(
      noSourceView,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      { rationale: "blocked" }
    );
    assert("Missing source view blocks Impact UPDATE", isDenied(result));
    result = await request(
      full,
      "changeOrderImpactDecision",
      "PATCH",
      `?id=eq.${encodeURIComponent(poDecision)}`,
      {
        decisionStatus: "Resolved",
        assessmentSnapshot: { directMutation: true },
        revision: 99,
        rationale: "direct mutation",
        resolutionNote: "direct mutation"
      }
    );
    const decisionAfterDirectUpdate = (
      await db.query(
        `SELECT "decisionStatus", "assessmentSnapshot", "revision", "rationale", "resolutionNote"
         FROM "changeOrderImpactDecision" WHERE "id" = $1`,
        [poDecision]
      )
    ).rows[0];
    assert(
      "Source-authorized direct Impact UPDATE is denied",
      hasNoVisibleMutation(result) &&
        decisionAfterDirectUpdate.decisionStatus === "Action required" &&
        decisionAfterDirectUpdate.assessmentSnapshot.directMutation === undefined &&
        decisionAfterDirectUpdate.revision === 1 &&
        decisionAfterDirectUpdate.rationale === null &&
        decisionAfterDirectUpdate.resolutionNote === null
    );
    result = await request(
      full,
      "changeOrderImpactDecision",
      "DELETE",
      `?id=eq.${encodeURIComponent(poDecision)}`
    );
    const decisionStillExists = (
      await db.query(`SELECT count(*)::int AS count FROM "changeOrderImpactDecision" WHERE "id" = $1`, [poDecision])
    ).rows[0].count;
    assert("Direct Impact DELETE is denied", hasNoVisibleMutation(result) && decisionStillExists === 1);

    const provenanceId = (
      await db.query(
        `SELECT "id" FROM "changeOrderImpactDecisionAffectedItem"
         WHERE "decisionId" = $1 ORDER BY "createdAt" LIMIT 1`,
        [poDecision]
      )
    ).rows[0].id;
    result = await request(taskWriter, "changeOrderImpactDecisionAffectedItem", "POST", "", {
      companyId: company,
      decisionId: poDecision,
      affectedItemId: `${prefix}-direct-provenance`,
      affectedItemSourceId: `${prefix}-direct-source`,
      affectedItemLabel: "Direct mutation",
      startedBy: userId,
      createdBy: userId
    });
    const directProvenanceCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionAffectedItem"
         WHERE "affectedItemId" = $1`,
        [`${prefix}-direct-provenance`]
      )
    ).rows[0].count;
    assert("Direct provenance INSERT is denied", hasNoVisibleMutation(result) && directProvenanceCount === 0);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionAffectedItem",
      "PATCH",
      `?id=eq.${encodeURIComponent(provenanceId)}`,
      { affectedItemLabel: "Direct mutation" }
    );
    const provenanceAfterDirectUpdate = (
      await db.query(
        `SELECT "affectedItemLabel" FROM "changeOrderImpactDecisionAffectedItem" WHERE "id" = $1`,
        [provenanceId]
      )
    ).rows[0].affectedItemLabel;
    assert(
      "Direct provenance UPDATE is denied",
      hasNoVisibleMutation(result) && provenanceAfterDirectUpdate === "RLS fixture"
    );
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionAffectedItem",
      "DELETE",
      `?id=eq.${encodeURIComponent(provenanceId)}`
    );
    const provenanceStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionAffectedItem" WHERE "id" = $1`,
        [provenanceId]
      )
    ).rows[0].count;
    assert("Direct provenance DELETE is denied", hasNoVisibleMutation(result) && provenanceStillExists === 1);

    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: sameNoticeTask,
      companyId: company,
      createdBy: userId
    });
    const directLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, sameNoticeTask]
      )
    ).rows[0].count;
    assert("Direct same-Change-Notice task-link INSERT is denied", hasNoVisibleMutation(result) && directLinkCount === 0);
    const linkQuery = `?decisionId=eq.${encodeURIComponent(poDecision)}&actionTaskId=eq.${encodeURIComponent(task)}`;
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "PATCH", linkQuery, {
      updatedBy: userId
    });
    const linkAfterDirectUpdate = (
      await db.query(
        `SELECT "updatedBy" FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, task]
      )
    ).rows[0].updatedBy;
    assert("Direct task-link UPDATE is denied", hasNoVisibleMutation(result) && linkAfterDirectUpdate === null);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "DELETE", linkQuery);
    const linkStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, task]
      )
    ).rows[0].count;
    assert("Direct task-link DELETE is denied", hasNoVisibleMutation(result) && linkStillExists === 1);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: otherTask,
      companyId: company,
      createdBy: userId
    });
    const crossNoticeLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, otherTask]
      )
    ).rows[0].count;
    assert("Cross-Change-Notice task link is blocked", isDenied(result) && crossNoticeLinkCount === 0);
    result = await request(taskWriter, "changeOrderImpactDecisionActionTask", "POST", "", {
      decisionId: poDecision,
      actionTaskId: otherCompanyTask,
      companyId: company,
      createdBy: userId
    });
    const crossCompanyLinkCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionActionTask"
         WHERE "decisionId" = $1 AND "actionTaskId" = $2`,
        [poDecision, otherCompanyTask]
      )
    ).rows[0].count;
    assert("Cross-company task link is blocked", isDenied(result) && crossCompanyLinkCount === 0);

    const historyId = (
      await db.query(
        `SELECT "id" FROM "changeOrderImpactDecisionHistory"
         WHERE "decisionId" = $1 ORDER BY "createdAt" LIMIT 1`,
        [poDecision]
      )
    ).rows[0].id;
    result = await request(taskWriter, "changeOrderImpactDecisionHistory", "POST", "", {
      companyId: company,
      decisionId: poDecision,
      targetType: "purchaseOrderLine",
      targetId: `${prefix}-po`,
      eventType: "Direct mutation",
      newStatus: "Resolved",
      newSnapshot: {},
      createdBy: userId
    });
    const directHistoryCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionHistory"
         WHERE "decisionId" = $1 AND "eventType" = 'Direct mutation'`,
        [poDecision]
      )
    ).rows[0].count;
    assert("Direct history INSERT is denied", hasNoVisibleMutation(result) && directHistoryCount === 0);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionHistory",
      "PATCH",
      `?id=eq.${encodeURIComponent(historyId)}`,
      { rationale: "Direct mutation" }
    );
    const historyAfterDirectUpdate = (
      await db.query(
        `SELECT "rationale" FROM "changeOrderImpactDecisionHistory" WHERE "id" = $1`,
        [historyId]
      )
    ).rows[0].rationale;
    assert("Direct history UPDATE is denied", hasNoVisibleMutation(result) && historyAfterDirectUpdate === null);
    result = await request(
      taskWriter,
      "changeOrderImpactDecisionHistory",
      "DELETE",
      `?id=eq.${encodeURIComponent(historyId)}`
    );
    const historyStillExists = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderImpactDecisionHistory" WHERE "id" = $1`,
        [historyId]
      )
    ).rows[0].count;
    assert("Direct history DELETE is denied", hasNoVisibleMutation(result) && historyStillExists === 1);

    result = await request(
      taskWriter,
      "changeOrderActionTask",
      "PATCH",
      `?id=eq.${encodeURIComponent(task)}`,
      { taskOrigin: "Impact follow-up" }
    );
    const apiTaskOriginAfterUpdate = (
      await db.query(`SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`, [task])
    ).rows[0].taskOrigin;
    assert(
      "Direct taskOrigin UPDATE is blocked",
      result.status >= 400 && result.status < 500 && apiTaskOriginAfterUpdate === "Manual"
    );
    result = await request(taskWriter, "changeOrderActionTask", "POST", "", {
      changeOrderId: notice,
      name: `${prefix}-direct-origin-insert`,
      companyId: company,
      createdBy: userId,
      taskOrigin: "Impact follow-up"
    });
    const apiDirectOriginInsertCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM "changeOrderActionTask"
         WHERE "changeOrderId" = $1 AND "name" = $2`,
        [notice, `${prefix}-direct-origin-insert`]
      )
    ).rows[0].count;
    assert(
      "Direct taskOrigin INSERT is blocked",
      result.status >= 400 && result.status < 500 && apiDirectOriginInsertCount === 0
    );
    result = await request(
      taskWriter,
      "changeOrderActionTask",
      "PATCH",
      `?id=eq.${encodeURIComponent(task)}`,
      { name: `${prefix}-ordinary-update` }
    );
    const taskAfterOrdinaryUpdate = (
      await db.query(
        `SELECT "name", "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = $1`,
        [task]
      )
    ).rows[0];
    assert(
      "Ordinary task UPDATE remains available",
      result.status === 200 && rows(result).length === 1 &&
        taskAfterOrdinaryUpdate.name === `${prefix}-ordinary-update` &&
        taskAfterOrdinaryUpdate.taskOrigin === "Manual"
    );

    await setEmployeePermissions(db, employeeUserId, [company, otherCompany], {
      partsView: true,
      partsUpdate: false,
      purchasingView: false,
      productionView: true
    });
    const sharedEmployeeJwt = getEmployeeJwt(employeeUserId);
    const sharedDecisionRead = await employeeRequest(
      sharedEmployeeJwt,
      "changeOrderImpactDecision",
      "GET",
      `?id=eq.${encodeURIComponent(sharedDecisionId)}&companyId=eq.${encodeURIComponent(otherCompany)}&targetType=eq.job&select=id`
    );
    assert(
      "Employee can read Company B same-ID Job decision",
      sharedDecisionRead.status === 200 && rows(sharedDecisionRead).length === 1
    );
    const sharedChildQuery =
      `?companyId=eq.${encodeURIComponent(company)}&decisionId=eq.${encodeURIComponent(sharedDecisionId)}&select=id`;
    const sharedProvenanceRead = await employeeRequest(
      sharedEmployeeJwt,
      "changeOrderImpactDecisionAffectedItem",
      "GET",
      sharedChildQuery
    );
    assert(
      "Company A same-ID provenance cannot borrow Company B authorization",
      sharedProvenanceRead.status === 200 && rows(sharedProvenanceRead).length === 0
    );
    const sharedHistoryRead = await employeeRequest(
      sharedEmployeeJwt,
      "changeOrderImpactDecisionHistory",
      "GET",
      sharedChildQuery
    );
    assert(
      "Company A same-ID history cannot borrow Company B authorization",
      sharedHistoryRead.status === 200 && rows(sharedHistoryRead).length === 0
    );

    await runEmployeeSessionChecks(
      db,
      company,
      employeeUserId,
      notice,
      poDecision,
      jobDecision,
      materialDecision,
      task
    );

    console.log("DIRECT POSTGREST AND EMPLOYEE SESSION RLS CHECKS PASSED");
  } finally {
    let cleanupFailed = false;
    const cleanup = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupFailed = true;
        console.error(`CLEANUP FAILED: ${label}`, error);
      }
    };

    if (employeeUserId && employeeOriginalPermissions !== undefined) {
      await cleanup("restore employee permissions", () =>
        db.query(
          `UPDATE "userPermission" SET "permissions" = $1::jsonb WHERE "id" = $2`,
          [JSON.stringify(employeeOriginalPermissions), employeeUserId]
        )
      );
    }
    for (const [membershipUserId, membershipCompanyId] of fixture.employeeMemberships) {
      await cleanup(`remove employee membership ${membershipCompanyId}`, () =>
        db.query(
          `DELETE FROM "userToCompany" WHERE "userId" = $1 AND "companyId" = $2`,
          [membershipUserId, membershipCompanyId]
        )
      );
    }
    for (const [decisionId, actionTaskId, companyId] of fixture.links) {
      await cleanup(`delete task link ${decisionId}/${actionTaskId}`, () =>
        db.query(
          `DELETE FROM "changeOrderImpactDecisionActionTask"
           WHERE "decisionId" = $1 AND "actionTaskId" = $2 AND "companyId" = $3`,
          [decisionId, actionTaskId, companyId]
        )
      );
    }
    if (fixture.history.length) {
      await cleanup("delete history fixtures", () =>
        db.query(
          `DELETE FROM "changeOrderImpactDecisionHistory" WHERE "id" = ANY($1::text[])`,
          [fixture.history]
        )
      );
    }
    if (fixture.provenance.length) {
      await cleanup("delete provenance fixtures", () =>
        db.query(
          `DELETE FROM "changeOrderImpactDecisionAffectedItem" WHERE "id" = ANY($1::text[])`,
          [fixture.provenance]
        )
      );
    }
    if (fixture.decisions.length) {
      await cleanup("delete decision fixtures", () =>
        db.query(
          `DELETE FROM "changeOrderImpactDecision" WHERE "id" = ANY($1::text[])`,
          [fixture.decisions]
        )
      );
    }
    if (fixture.tasks.length) {
      await cleanup("delete task fixtures", () =>
        db.query(`DELETE FROM "changeOrderActionTask" WHERE "id" = ANY($1::text[])`, [fixture.tasks])
      );
    }
    if (fixture.notices.length) {
      await cleanup("delete Change Notice fixtures", () =>
        db.query(`DELETE FROM "changeOrder" WHERE "id" = ANY($1::text[])`, [fixture.notices])
      );
    }
    if (fixture.apiKeys.length) {
      await cleanup("delete API key fixtures", () =>
        db.query(`DELETE FROM "apiKey" WHERE "id" = ANY($1::text[])`, [fixture.apiKeys])
      );
    }
    for (const companyId of fixture.companies) {
      const quotedCompanyId = companyId.replaceAll('"', '""');
      await cleanup(`drop search index table ${companyId}`, () =>
        db.query(`DROP TABLE IF EXISTS "searchIndex_${quotedCompanyId}" CASCADE`)
      );
      await cleanup(`drop audit log table ${companyId}`, () =>
        db.query(`DROP TABLE IF EXISTS "auditLog_${quotedCompanyId}" CASCADE`)
      );
    }
    if (fixture.companies.length) {
      await cleanup("delete company fixtures", () =>
        db.query(`DELETE FROM "company" WHERE "id" = ANY($1::text[])`, [fixture.companies])
      );
    }
    await cleanup("close database connection", () => db.end());
    if (cleanupFailed) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
