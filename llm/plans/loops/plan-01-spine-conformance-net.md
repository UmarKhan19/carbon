# Spine Harness + Conformance Net — Implementation Plan (Plan 1 of the loops system)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable executable-check harness (the "spine"), delivered through the first anchor — a **conformance net** that fails CI when *new* migrations introduce a deprecated pattern (legacy `NUMERIC(x,y)`, legacy RLS helpers), while grandfathering existing violations via a baseline.

**Architecture:** A new `@carbon/spine` package holds typed `ConformanceCheck`s (pure functions over file contents) and a baseline-aware runner. A CI-facing vitest test scans the real `packages/database/supabase/migrations/*.sql`, subtracts a committed baseline of pre-existing violations, and fails on any *new* one. Because root `pnpm test` → `turbo run test` auto-discovers package `test` scripts, the gate runs in the existing `check.yml` `test` job with no workflow edits.

**Tech Stack:** TypeScript, Vitest v4 (no globals — import `describe/it/expect`), Biome (lint/format), `tsx` (scripts), pnpm workspaces + Turborepo. Package scope `@carbon/*`.

**Scope boundary:** This plan builds the harness + conformance net only. It is **not** the DB-connected invariant net (Plan 2, reuses this harness) nor the reproduce→fix conductor (Plan 3). Spec: `llm/plans/loops/design.md` §5.7 (conformance net), §5.8 (spine governance), §6 (typed contracts).

---

## File Structure

```
packages/spine/
├── package.json                              # @carbon/spine, mirrors @carbon/utils (trimmed, no React)
├── tsconfig.json                             # extends @carbon/config/tsconfig/react-library.json
├── vitest.config.ts                          # re-export @carbon/config/vitest
├── README.md                                 # what the spine is; how to add a check; how to re-baseline
└── src/
    ├── index.ts                              # barrel: types, checks, runner
    ├── check.ts                              # types: Violation, ConformanceCheck (typed contract)
    ├── sources/
    │   ├── migrations.ts                     # repoRoot(), migrationsDir(), loadSqlFiles()
    │   └── migrations.test.ts
    ├── conformance/
    │   ├── no-numeric-precision.ts           # forbids NUMERIC(x,y)
    │   ├── no-numeric-precision.test.ts
    │   ├── no-legacy-rls.ts                  # forbids has_company_permission()
    │   ├── no-legacy-rls.test.ts
    │   └── baseline.json                     # grandfathered existing violations (generated)
    ├── baseline.ts                           # keyOf(), loadBaseline(), writeBaseline()
    ├── baseline.test.ts
    ├── run.ts                                # CONFORMANCE_CHECKS, scanAll(), newViolations()
    ├── run.test.ts                           # CI-facing gate: zero NEW violations
    └── scripts/
        └── generate-baseline.ts              # `pnpm --filter @carbon/spine baseline`
```

Each file has one responsibility: `check.ts` = the typed contract; `conformance/*` = one deprecated-pattern scanner each (pure); `sources/*` = reading SQL off disk; `baseline.ts` = grandfathering; `run.ts` = composition; `run.test.ts` = the gate.

---

## Task 0: Scaffold the `@carbon/spine` package

**Files:**
- Create: `packages/spine/package.json`
- Create: `packages/spine/tsconfig.json`
- Create: `packages/spine/vitest.config.ts`
- Create: `packages/spine/src/index.ts`
- Create: `packages/spine/src/smoke.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@carbon/spine",
  "version": "0.0.0",
  "private": true,
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "clean": "rimraf .turbo node_modules dist",
    "lint": "biome lint --write ",
    "test": "vitest run",
    "typecheck": "tsgo --noEmit",
    "baseline": "tsx src/scripts/generate-baseline.ts"
  },
  "devDependencies": {
    "@carbon/config": "workspace:*",
    "@types/node": "catalog:",
    "rimraf": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

> If `@types/node`, `rimraf`, or `tsx` are not in the root `pnpm-workspace.yaml` catalog, replace `"catalog:"` with the same version string `@carbon/utils` or the root `package.json` uses for that dep. Verify with: `grep -nE "tsx|rimraf|@types/node" pnpm-workspace.yaml package.json`.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "@carbon/config/tsconfig/react-library.json",
  "include": ["src"],
  "exclude": ["dist", "build", "node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
export { default } from "@carbon/config/vitest";
```

- [ ] **Step 4: Write a placeholder `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 5: Write a smoke test `src/smoke.test.ts`**

```typescript
import { describe, expect, it } from "vitest";

describe("@carbon/spine", () => {
  it("runs", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 6: Install + verify the package is wired up**

Run: `pnpm install`
Then: `pnpm --filter '@carbon/spine' test`
Expected: 1 passing test (`@carbon/spine > runs`). If `pnpm --filter` reports "No projects matched", the workspace glob `packages/*` did not pick it up — confirm `packages/spine/package.json` exists and re-run `pnpm install`.

- [ ] **Step 7: Commit**

```bash
git add packages/spine pnpm-lock.yaml
git commit -m "feat(spine): scaffold @carbon/spine package"
```

---

## Task 1: The typed contract (`Violation`, `ConformanceCheck`)

**Files:**
- Create: `packages/spine/src/check.ts`

This is data-only (types + a key helper later). No test of its own; it's exercised by every check test.

- [ ] **Step 1: Write `src/check.ts`**

```typescript
/** One occurrence of a forbidden pattern. */
export type Violation = {
  /** Migration file basename, e.g. "20260101120000_foo.sql", or "<inline>" in unit tests. */
  file: string;
  /** 1-based line number; 0 if unknown. */
  line: number;
  /** The exact matched text. */
  snippet: string;
  /** Human-readable reason. */
  message: string;
};

/**
 * A conformance check forbids a single deprecated pattern.
 * `scan` is PURE: same (file, contents) in → same violations out. No I/O.
 */
export type ConformanceCheck = {
  id: string;
  description: string;
  /** Provenance: the transition event that retired the old pattern (spec §5.7). */
  provenance: {
    deprecates: string;
    replacedBy: string;
    /** Migration/commit that flipped the standard, if known. */
    since?: string;
  };
  scan(file: string, contents: string): Violation[];
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter '@carbon/spine' typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/spine/src/check.ts
git commit -m "feat(spine): add ConformanceCheck typed contract"
```

---

## Task 2: Conformance check — forbid `NUMERIC(x,y)`

**Files:**
- Create: `packages/spine/src/conformance/no-numeric-precision.ts`
- Test: `packages/spine/src/conformance/no-numeric-precision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { noNumericPrecision } from "./no-numeric-precision";

describe("noNumericPrecision", () => {
  it("flags NUMERIC(x,y)", () => {
    const v = noNumericPrecision.scan("a.sql", "amount NUMERIC(18, 4) NOT NULL");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
    expect(v[0].snippet.toLowerCase().replace(/\s/g, "")).toBe("numeric(18,4)");
  });

  it("allows bare NUMERIC", () => {
    const v = noNumericPrecision.scan("a.sql", "amount NUMERIC NOT NULL");
    expect(v).toHaveLength(0);
  });

  it("reports the correct line across multiple lines", () => {
    const sql = ["id uuid,", "price NUMERIC(10,2),", "qty NUMERIC"].join("\n");
    const v = noNumericPrecision.scan("a.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it("is case-insensitive", () => {
    const v = noNumericPrecision.scan("a.sql", "x numeric(5,2)");
    expect(v).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter '@carbon/spine' test -- src/conformance/no-numeric-precision.test.ts`
Expected: FAIL — cannot resolve `./no-numeric-precision`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { ConformanceCheck, Violation } from "../check";

/** Matches NUMERIC(<int>, <int>) — the deprecated fixed-precision form. */
const NUMERIC_PRECISION = /numeric\s*\(\s*\d+\s*,\s*\d+\s*\)/gi;

export const noNumericPrecision: ConformanceCheck = {
  id: "no-numeric-precision",
  description: "Use bare NUMERIC, not NUMERIC(x,y).",
  provenance: {
    deprecates: "NUMERIC(x,y)",
    replacedBy: "NUMERIC"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      // matchAll on the per-line string avoids cross-line lastIndex state.
      for (const m of text.matchAll(NUMERIC_PRECISION)) {
        violations.push({
          file,
          line: i + 1,
          snippet: m[0],
          message: "NUMERIC(x,y) is deprecated; use bare NUMERIC."
        });
      }
    });
    return violations;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter '@carbon/spine' test -- src/conformance/no-numeric-precision.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine/src/conformance/no-numeric-precision.ts packages/spine/src/conformance/no-numeric-precision.test.ts
git commit -m "feat(spine): conformance check forbidding NUMERIC(x,y)"
```

---

## Task 3: Conformance check — forbid legacy RLS helper

**Files:**
- Create: `packages/spine/src/conformance/no-legacy-rls.ts`
- Test: `packages/spine/src/conformance/no-legacy-rls.test.ts`

> Rationale: the current RLS pattern is `get_companies_with_employee_permission(...)`; the deprecated one used `has_role(...) AND has_company_permission(...)`. We key on `has_company_permission(` as the unambiguous deprecated marker (spec §5.7; transition event `20250201181148_rls-refactor.sql`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { noLegacyRls } from "./no-legacy-rls";

describe("noLegacyRls", () => {
  it("flags has_company_permission(...)", () => {
    const sql = 'USING (has_company_permission(\'view\', "companyId"))';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("allows the current get_companies_with_employee_permission helper", () => {
    const sql =
      'USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(\'view\'))::text[]))';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(0);
  });

  it("records provenance pointing at the RLS refactor migration", () => {
    expect(noLegacyRls.provenance.since).toBe("20250201181148_rls-refactor.sql");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter '@carbon/spine' test -- src/conformance/no-legacy-rls.test.ts`
Expected: FAIL — cannot resolve `./no-legacy-rls`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { ConformanceCheck, Violation } from "../check";

const LEGACY_RLS = /has_company_permission\s*\(/gi;

export const noLegacyRls: ConformanceCheck = {
  id: "no-legacy-rls",
  description:
    "Use get_companies_with_employee_permission(...), not has_role()/has_company_permission().",
  provenance: {
    deprecates: "has_company_permission()",
    replacedBy: "get_companies_with_employee_permission()",
    since: "20250201181148_rls-refactor.sql"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(LEGACY_RLS)) {
        violations.push({
          file,
          line: i + 1,
          snippet: m[0],
          message:
            "Deprecated RLS helper; use get_companies_with_employee_permission()."
        });
      }
    });
    return violations;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter '@carbon/spine' test -- src/conformance/no-legacy-rls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine/src/conformance/no-legacy-rls.ts packages/spine/src/conformance/no-legacy-rls.test.ts
git commit -m "feat(spine): conformance check forbidding legacy RLS helper"
```

---

## Task 4: Migration source loader

**Files:**
- Create: `packages/spine/src/sources/migrations.ts`
- Test: `packages/spine/src/sources/migrations.test.ts`

- [ ] **Step 1: Write the failing test** (fixture-based, no dependency on the real repo tree)

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSqlFiles } from "./migrations";

describe("loadSqlFiles", () => {
  it("loads .sql files sorted by name, ignoring non-sql", () => {
    const dir = mkdtempSync(join(tmpdir(), "spine-"));
    writeFileSync(join(dir, "b.sql"), "SELECT 2;");
    writeFileSync(join(dir, "a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const files = loadSqlFiles(dir);
    expect(files.map((f) => f.file)).toEqual(["a.sql", "b.sql"]);
    expect(files[0].contents).toBe("SELECT 1;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter '@carbon/spine' test -- src/sources/migrations.test.ts`
Expected: FAIL — cannot resolve `./migrations`.

- [ ] **Step 3: Write the implementation**

```typescript
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SqlFile = { file: string; contents: string };

const MIGRATIONS_REL = "packages/database/supabase/migrations";

/** Repo root, resolved from the package cwd (Vitest/Turbo run with cwd = packages/spine). */
export function repoRoot(): string {
  const root = resolve(process.cwd(), "../..");
  if (!existsSync(join(root, MIGRATIONS_REL))) {
    throw new Error(
      `Could not locate repo root from cwd=${process.cwd()} (resolved ${root}); ${MIGRATIONS_REL} not found.`
    );
  }
  return root;
}

export function migrationsDir(root: string): string {
  return join(root, MIGRATIONS_REL);
}

export function loadSqlFiles(dir: string): SqlFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, contents: readFileSync(join(dir, f), "utf8") }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter '@carbon/spine' test -- src/sources/migrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine/src/sources/migrations.ts packages/spine/src/sources/migrations.test.ts
git commit -m "feat(spine): migration SQL file loader"
```

---

## Task 5: Baseline (grandfather existing violations)

**Files:**
- Create: `packages/spine/src/baseline.ts`
- Test: `packages/spine/src/baseline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { keyOf, parseBaseline } from "./baseline";
import type { Violation } from "./check";

const v: Violation = {
  file: "x.sql",
  line: 3,
  snippet: "NUMERIC(10,2)",
  message: "deprecated"
};

describe("baseline", () => {
  it("derives a stable key from checkId + file + snippet (line-independent)", () => {
    const a = keyOf("no-numeric-precision", v);
    const b = keyOf("no-numeric-precision", { ...v, line: 99 });
    expect(a).toBe(b);
    expect(a).toBe("no-numeric-precision::x.sql::NUMERIC(10,2)");
  });

  it("parses a baseline JSON array into a Set", () => {
    const set = parseBaseline('["k1","k2"]');
    expect(set.has("k1")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("returns an empty Set for missing/invalid JSON", () => {
    expect(parseBaseline(undefined).size).toBe(0);
    expect(parseBaseline("not json").size).toBe(0);
  });
});
```

> Key is line-independent on purpose: re-numbering a file (an unrelated edit above it) must not turn a grandfathered violation into a "new" one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter '@carbon/spine' test -- src/baseline.test.ts`
Expected: FAIL — cannot resolve `./baseline`.

- [ ] **Step 3: Write the implementation**

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Violation } from "./check";

export type BaselineKey = string;

const BASELINE_PATH = join(process.cwd(), "src/conformance/baseline.json");

export function keyOf(checkId: string, v: Violation): BaselineKey {
  return `${checkId}::${v.file}::${v.snippet}`;
}

/** Pure parse so it is unit-testable without disk. */
export function parseBaseline(json: string | undefined): Set<BaselineKey> {
  if (!json) return new Set();
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? new Set(arr as BaselineKey[]) : new Set();
  } catch {
    return new Set();
  }
}

export function loadBaseline(path = BASELINE_PATH): Set<BaselineKey> {
  try {
    return parseBaseline(readFileSync(path, "utf8"));
  } catch {
    return new Set();
  }
}

export function writeBaseline(keys: BaselineKey[], path = BASELINE_PATH): void {
  writeFileSync(path, `${JSON.stringify([...keys].sort(), null, 2)}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter '@carbon/spine' test -- src/baseline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine/src/baseline.ts packages/spine/src/baseline.test.ts
git commit -m "feat(spine): line-independent violation baseline"
```

---

## Task 6: Runner + baseline generation script

**Files:**
- Create: `packages/spine/src/run.ts`
- Create: `packages/spine/src/scripts/generate-baseline.ts`
- Test: `packages/spine/src/run.test.ts` (unit portion first; the real-migrations gate is Task 7)

- [ ] **Step 1: Write the failing test for `scanAll` (pure composition)**

```typescript
import { describe, expect, it } from "vitest";
import { scanAll } from "./run";

describe("scanAll", () => {
  it("returns every (checkId, violation) across files and checks", () => {
    const files = [
      { file: "a.sql", contents: "x NUMERIC(10,2)" },
      { file: "b.sql", contents: "USING (has_company_permission('view'))" },
      { file: "c.sql", contents: "y NUMERIC" }
    ];
    const found = scanAll(files);
    const ids = found.map((f) => f.checkId).sort();
    expect(ids).toEqual(["no-legacy-rls", "no-numeric-precision"]);
    expect(found.every((f) => typeof f.violation.line === "number")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter '@carbon/spine' test -- src/run.test.ts`
Expected: FAIL — cannot resolve `./run`.

- [ ] **Step 3: Write `src/run.ts`**

```typescript
import { keyOf, loadBaseline } from "./baseline";
import type { ConformanceCheck, Violation } from "./check";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import { loadSqlFiles, migrationsDir, repoRoot, type SqlFile } from "./sources/migrations";

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  noNumericPrecision,
  noLegacyRls
];

export type Finding = { checkId: string; violation: Violation };

export function scanAll(
  files: SqlFile[],
  checks: ConformanceCheck[] = CONFORMANCE_CHECKS
): Finding[] {
  const out: Finding[] = [];
  for (const { file, contents } of files) {
    for (const check of checks) {
      for (const violation of check.scan(file, contents)) {
        out.push({ checkId: check.id, violation });
      }
    }
  }
  return out;
}

/** Findings in the real migrations that are NOT grandfathered by the baseline. */
export function newViolations(): Finding[] {
  const files = loadSqlFiles(migrationsDir(repoRoot()));
  const baseline = loadBaseline();
  return scanAll(files).filter((f) => !baseline.has(keyOf(f.checkId, f.violation)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter '@carbon/spine' test -- src/run.test.ts`
Expected: PASS (the `scanAll` test).

- [ ] **Step 5: Write the baseline generation script `src/scripts/generate-baseline.ts`**

```typescript
import { keyOf, writeBaseline } from "../baseline";
import { scanAll } from "../run";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";

const files = loadSqlFiles(migrationsDir(repoRoot()));
const keys = scanAll(files).map((f) => keyOf(f.checkId, f.violation));
writeBaseline(keys);
console.log(`Wrote ${keys.length} baselined conformance violations.`);
```

- [ ] **Step 6: Generate the baseline against the real migrations**

Run: `pnpm --filter '@carbon/spine' baseline`
Expected: prints e.g. `Wrote <N> baselined conformance violations.` and creates `packages/spine/src/conformance/baseline.json`. `N` should be large (hundreds — the legacy `NUMERIC(x,y)` and RLS occurrences). Sanity-check it is non-empty:
`head -5 packages/spine/src/conformance/baseline.json`

- [ ] **Step 7: Commit**

```bash
git add packages/spine/src/run.ts packages/spine/src/run.test.ts packages/spine/src/scripts/generate-baseline.ts packages/spine/src/conformance/baseline.json
git commit -m "feat(spine): conformance runner + generated baseline"
```

---

## Task 7: The CI-facing gate test (zero NEW violations)

**Files:**
- Modify: `packages/spine/src/run.test.ts` (append the gate test)

- [ ] **Step 1: Append the gate test to `src/run.test.ts`**

```typescript
import { newViolations } from "./run";

describe("conformance gate (real migrations vs baseline)", () => {
  it("introduces no NEW deprecated patterns beyond the committed baseline", () => {
    const fresh = newViolations();
    const detail = fresh
      .map(
        (f) =>
          `  ${f.checkId}  ${f.violation.file}:${f.violation.line}  ${f.violation.snippet}`
      )
      .join("\n");
    expect(fresh, `New conformance violations:\n${detail}`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the whole package suite — the gate must be GREEN now**

Run: `pnpm --filter '@carbon/spine' test`
Expected: ALL tests pass, including the gate (because every current violation is in the baseline → `newViolations()` is empty).

- [ ] **Step 3: Prove the gate actually catches a NEW violation (regression-replay)**

Create a throwaway migration with a forbidden pattern:
```bash
printf 'CREATE TABLE spine_probe (amount NUMERIC(10,2));\n' > packages/database/supabase/migrations/29990101000000_spine_probe.sql
```
Run: `pnpm --filter '@carbon/spine' test -- src/run.test.ts`
Expected: the gate test FAILS, naming `29990101000000_spine_probe.sql` with a `numeric(10,2)` snippet. This is the proof the gate works.

Now delete the probe:
```bash
rm packages/database/supabase/migrations/29990101000000_spine_probe.sql
```
Re-run: `pnpm --filter '@carbon/spine' test -- src/run.test.ts`
Expected: PASS again.

- [ ] **Step 4: Commit**

```bash
git add packages/spine/src/run.test.ts
git commit -m "feat(spine): CI gate failing on new conformance violations"
```

---

## Task 8: Barrel export, README, and CI verification

**Files:**
- Modify: `packages/spine/src/index.ts`
- Create: `packages/spine/README.md`

- [ ] **Step 1: Write the barrel `src/index.ts`**

```typescript
export type { ConformanceCheck, Violation } from "./check";
export { noLegacyRls } from "./conformance/no-legacy-rls";
export { noNumericPrecision } from "./conformance/no-numeric-precision";
export { CONFORMANCE_CHECKS, type Finding, newViolations, scanAll } from "./run";
```

- [ ] **Step 2: Write `README.md`**

```markdown
# @carbon/spine

Executable checks for the loop system's "spine" (see `llm/plans/loops/design.md`).

## Conformance net

Forbids deprecated code patterns in migrations. Existing violations are
grandfathered in `src/conformance/baseline.json`; only **new** violations fail CI.

- Add a check: implement a `ConformanceCheck` under `src/conformance/`, add it to
  `CONFORMANCE_CHECKS` in `src/run.ts`, then re-baseline.
- Re-baseline (after intentionally accepting current state): `pnpm --filter @carbon/spine baseline`
- Run the gate: `pnpm --filter @carbon/spine test`

Each check records `provenance` (the transition event that retired the old pattern).
```

- [ ] **Step 3: Verify typecheck, lint, and the full suite pass**

Run: `pnpm --filter '@carbon/spine' typecheck`
Expected: no errors.
Run: `pnpm --filter '@carbon/spine' lint`
Expected: no errors (Biome may auto-format).
Run: `pnpm --filter '@carbon/spine' test`
Expected: all pass.

- [ ] **Step 4: Verify it runs as part of the monorepo gate (what CI does)**

Run: `pnpm test`
Expected: Turbo runs `@carbon/spine`'s `test` script among the others and it passes. This confirms `check.yml`'s `test` job (which runs `pnpm test`) now includes the conformance gate — **no workflow edit required.**

- [ ] **Step 5: Commit**

```bash
git add packages/spine/src/index.ts packages/spine/README.md
git commit -m "feat(spine): barrel exports + README"
```

---

## Self-Review (run before handoff)

- **Spec coverage:** §5.7 conformance net → Tasks 2,3,7 (deprecated-pattern gates + transition-event provenance); §6 typed contracts → Task 1 (`ConformanceCheck`/`Violation`); §5.8 "spine runs against HEAD in CI" → Tasks 7,8 (gate runs in `check.yml` `test` job). Baselining (legacy grandfathering) → Tasks 5,6. *Not covered here (by design):* invariant net (Plan 2), reproduce-fix conductor (Plan 3), drift-detection loop / scoring / promotion-to-constraint (later milestones).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `Violation`, `ConformanceCheck`, `Finding`, `keyOf`, `scanAll`, `newViolations`, `loadSqlFiles`, `migrationsDir`, `repoRoot`, `loadBaseline`/`parseBaseline`/`writeBaseline` are defined once and used with identical signatures across Tasks 1–8.
- **Risk:** the only file touched outside `packages/spine` is the temporary probe migration in Task 7 step 3, which is created and deleted within the same task.

---

## Open items to confirm during execution

- Catalog entries for `tsx`, `rimraf`, `@types/node` (Task 0 note). If absent, copy the exact version from `@carbon/utils`/root.
- `tsgo` is the typecheck binary used by `@carbon/utils`; if `pnpm --filter '@carbon/spine' typecheck` cannot find it, ensure `@carbon/config` (which provides it) is in `devDependencies` (it is, per Task 0).
- Whether the team wants the conformance gate as its own named CI job (clearer failure signal) rather than folded into `test`. Default here: folded in (zero workflow edits). Promoting to a dedicated job is a 6-line addition to `check.yml` mirroring the existing `test` job.
