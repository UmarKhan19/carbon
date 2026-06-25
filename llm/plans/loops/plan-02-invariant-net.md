# Plan 2: Invariant Net (DB safety net)

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add the invariant net to `@carbon/checks`: runnable database assertions that must hold after any change. Each invariant is a `.sql` file returning *violating* rows (empty = healthy). The runner is DB-agnostic (injected `query`), so the core is fully unit-testable without a database; a thin CLI binds it to Postgres.

**Architecture:** `src/invariants/*.sql` (data — the rules) → `loadInvariants()` (read files) → `runInvariants(invariants, query)` (pure, injected query) → results. A CLI (`scripts/run-invariants.ts`) supplies a real `pg`-backed `query` from a connection string and exits non-zero on any violation. Mirrors the conformance net's "one file per check, register-and-go" growability.

**Grow-friendliness (explicit constraint):** a new invariant = one `.sql` file, nothing else. No code, no registration array even (the loader globs the directory). This is what lets a loop or human add invariants as one-file PRs, and lets the §5.8 drift loop propose them automatically.

**Runtime (NOT the static CI gate):** invariants need a live DB. They are run by the loop against its `crbn` worktree DB post-change, and/or nightly against prod — via the CLI, not the package `test` script. Plan 2 builds the mechanism; wiring it into the loop/nightly is a later integration plan.

**Tech Stack:** TypeScript, Vitest globals-off, Biome, tsx, `pg` for the CLI. `noUncheckedIndexedAccess` ON.

---

## File Structure
```
packages/checks/src/
├── invariants/
│   ├── tracked-entity-readable-id.sql   # NEW seed invariant (data)
│   └── <fixtures used only in tests are made in tmp dirs>
├── invariant.ts                          # NEW: Invariant type, loadInvariants(), runInvariants()
├── invariant.test.ts                     # NEW: unit tests with a fake query (no DB)
├── scripts/run-invariants.ts             # NEW: pg-backed CLI
└── index.ts                              # MODIFY: export invariant symbols
```

---

## Task 1: Invariant format + loader + runner (no DB)

**Files:** Create `packages/checks/src/invariant.ts` + `packages/checks/src/invariant.test.ts`.

- [ ] **Step 1: Write the failing test** `src/invariant.test.ts`:
```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInvariants, runInvariants } from "./invariant";

describe("loadInvariants", () => {
  it("loads each .sql file as an invariant keyed by basename (no extension)", () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-"));
    writeFileSync(join(dir, "b-rule.sql"), "SELECT 2;");
    writeFileSync(join(dir, "a-rule.sql"), "SELECT 1;");
    writeFileSync(join(dir, "notes.txt"), "ignore");
    const inv = loadInvariants(dir);
    expect(inv.map((i) => i.id)).toEqual(["a-rule", "b-rule"]);
    expect(inv[0]?.sql).toBe("SELECT 1;");
  });
});

describe("runInvariants", () => {
  it("passes when the query returns no rows, fails when it returns violating rows", async () => {
    const invariants = [
      { id: "ok", sql: "SELECT 1 WHERE false" },
      { id: "bad", sql: "SELECT id FROM t" }
    ];
    // Fake query: "bad" returns two violating rows; everything else empty.
    const query = async (sql: string) =>
      sql.includes("FROM t") ? [{ id: "x" }, { id: "y" }] : [];
    const results = await runInvariants(invariants, query);
    expect(results).toEqual([
      { id: "ok", passed: true, violatingRows: [] },
      { id: "bad", passed: false, violatingRows: [{ id: "x" }, { id: "y" }] }
    ]);
  });

  it("captures a query error as a failed result without throwing", async () => {
    const query = async () => {
      throw new Error("boom");
    };
    const [r] = await runInvariants([{ id: "e", sql: "SELECT bad" }], query);
    expect(r?.passed).toBe(false);
    expect(r?.error).toContain("boom");
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter '@carbon/checks' test -- src/invariant.test.ts` → FAIL (cannot resolve `./invariant`).

- [ ] **Step 3: Write `src/invariant.ts`**:
```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** An invariant is a SQL query that returns rows which VIOLATE the rule (empty = healthy). */
export type Invariant = { id: string; sql: string };

/** Injected DB access so the runner is testable without a real database. */
export type Query = (sql: string) => Promise<unknown[]>;

export type InvariantResult = {
  id: string;
  passed: boolean;
  violatingRows: unknown[];
  error?: string;
};

export function loadInvariants(dir: string): Invariant[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      id: f.replace(/\.sql$/, ""),
      sql: readFileSync(join(dir, f), "utf8")
    }));
}

export async function runInvariants(
  invariants: Invariant[],
  query: Query
): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  for (const inv of invariants) {
    try {
      const rows = await query(inv.sql);
      results.push({ id: inv.id, passed: rows.length === 0, violatingRows: rows });
    } catch (e) {
      results.push({
        id: inv.id,
        passed: false,
        violatingRows: [],
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return results;
}
```

- [ ] **Step 4:** Run the test → PASS (3 tests).
- [ ] **Step 5:** `pnpm --filter '@carbon/checks' typecheck` → clean. Commit: `git add packages/checks/src/invariant.ts packages/checks/src/invariant.test.ts && git commit -m "feat(core): invariant format + DB-agnostic runner"`.

---

## Task 2: First seed invariant (data, schema-verified)

**Files:** Create `packages/checks/src/invariants/tracked-entity-readable-id.sql`.

- [ ] **Step 1: Verify the real schema** before writing the SQL. Confirm the table/columns exist (do not guess):
`grep -rl "trackedEntity" packages/database/supabase/migrations | head` and inspect the create-table to confirm the exact table name (`trackedEntity`) and that it has `readableId` and `companyId` columns. If the names differ, use the real ones. (Invariant rationale: every tracked entity must have a `readableId` — a known Carbon rule.)

- [ ] **Step 2: Write `src/invariants/tracked-entity-readable-id.sql`** (adjust identifiers to match the verified schema):
```sql
-- invariant: every tracked entity has a readableId
-- returns rows that VIOLATE the rule (none = healthy)
SELECT "id", "companyId"
FROM "trackedEntity"
WHERE "readableId" IS NULL;
```

- [ ] **Step 3:** Add a unit test asserting the seed file loads (append to `src/invariant.test.ts`):
```typescript
import { repoRoot } from "./sources/migrations";
import { join } from "node:path";

describe("seed invariants", () => {
  it("loads the committed invariants directory", () => {
    const dir = join(repoRoot(), "packages/checks/src/invariants");
    const inv = loadInvariants(dir);
    expect(inv.length).toBeGreaterThanOrEqual(1);
    expect(inv.some((i) => i.id === "tracked-entity-readable-id")).toBe(true);
  });
});
```
Run `pnpm --filter '@carbon/checks' test -- src/invariant.test.ts` → PASS. (Note: `join`/`repoRoot` may already be imported — avoid duplicate imports.)

- [ ] **Step 4:** Commit: `git add packages/checks/src/invariants/tracked-entity-readable-id.sql packages/checks/src/invariant.test.ts && git commit -m "feat(core): seed invariant — tracked entity readableId"`.

---

## Task 3: The Postgres CLI (live-DB layer)

**Files:** Create `packages/checks/src/scripts/run-invariants.ts`; modify `packages/checks/package.json` (add `pg` dep + `invariants` script).

> This is the only DB-touching code. It is verified manually against a live DB (see Step 4), NOT in the static CI `test` job.

- [ ] **Step 1: Add `pg` to `packages/checks/package.json`.** Add to `devDependencies`: `"pg": "<version>"` and `"@types/pg": "<version>"` — use the versions already used by `@carbon/database` (inspect its package.json) or the catalog. Add a script: `"invariants": "tsx src/scripts/run-invariants.ts"`. Run `pnpm install`.

- [ ] **Step 2: Write `src/scripts/run-invariants.ts`**:
```typescript
import { join } from "node:path";
import { Client } from "pg";
import { loadInvariants, runInvariants, type Query } from "../invariant";
import { repoRoot } from "../sources/migrations";

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string.");
    process.exit(2);
  }
  const client = new Client({ connectionString });
  await client.connect();
  const query: Query = async (sql) => (await client.query(sql)).rows;
  try {
    const dir = join(repoRoot(), "packages/checks/src/invariants");
    const results = await runInvariants(loadInvariants(dir), query);
    let failed = 0;
    for (const r of results) {
      if (r.passed) {
        console.log(`PASS  ${r.id}`);
      } else {
        failed++;
        console.log(`FAIL  ${r.id}  (${r.error ?? `${r.violatingRows.length} violating rows`})`);
      }
    }
    console.log(`\n${results.length - failed}/${results.length} invariants healthy.`);
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await client.end();
  }
}

void main();
```

- [ ] **Step 3:** `pnpm --filter '@carbon/checks' typecheck` → clean. `lint` → clean.

- [ ] **Step 4: Manual live-DB check (only if a Postgres is reachable).** If a local `crbn` DB or any Carbon Postgres is available, run:
`DATABASE_URL=<conn> pnpm --filter '@carbon/checks' invariants`
Expected: prints PASS/FAIL per invariant and a summary; exits 0 if healthy. **If no DB is reachable in this environment, SKIP the live run and report it as a documented manual step** — do not fake it.

- [ ] **Step 5:** Commit: `git add packages/checks/package.json packages/checks/src/scripts/run-invariants.ts pnpm-lock.yaml && git commit -m "feat(core): invariant CLI (pg-backed)"`.

---

## Task 4: Barrel + README + verify

**Files:** Modify `packages/checks/src/index.ts`, `packages/checks/README.md`.

- [ ] **Step 1: Append to `src/index.ts`:**
```typescript
export {
  type Invariant,
  type InvariantResult,
  loadInvariants,
  type Query,
  runInvariants
} from "./invariant";
```
- [ ] **Step 2: Add a README section** documenting: invariants are `.sql` files returning violating rows; add one by dropping a file in `src/invariants/`; run via `DATABASE_URL=... pnpm --filter @carbon/checks invariants`; they run against a live DB (loop worktree / nightly), not the static CI gate.
- [ ] **Step 3:** `pnpm --filter '@carbon/checks' typecheck` (clean), `lint` (clean), `test` (all green — invariant unit tests + all prior).
- [ ] **Step 4:** Commit: `git commit -am "feat(core): export invariants + README"` (index.ts + README).

---

## Self-Review
- Spec coverage: design §5.1 invariant net (runnable DB assertions, global backstop) → Tasks 1–3; grow-friendliness (one `.sql` file per invariant, directory-globbed) → Tasks 1–2; "not the static CI gate / live DB via CLI" → Task 3.
- Placeholder scan: none. (Seed SQL identifiers are verified against the real schema in Task 2 Step 1.)
- Type consistency: `Invariant`, `Query`, `InvariantResult`, `loadInvariants`, `runInvariants` consistent across tasks.
- Landmines: the runner must NOT run in the package `test` script (no DB in CI) — only the CLI touches a DB. `noUncheckedIndexedAccess` → tests use `inv[0]?.sql`, `r?.passed`. Verify the `trackedEntity`/`readableId`/`companyId` identifiers against the schema before committing the seed SQL.
- Deferred (later integration plan, not Plan 2): wiring the CLI into the loop's worktree DB and the nightly prod run; adding the bulk of real invariants (JE balance, inventory conservation, orphan FKs, RLS isolation).
