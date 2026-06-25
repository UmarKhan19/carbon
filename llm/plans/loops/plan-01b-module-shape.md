# Plan 1b: Module-Shape Structure Check (second source type)

> **For agentic workers:** Use superpowers:subagent-driven-development to execute task-by-task. Steps use `- [ ]`.

**Goal:** Extend `@carbon/core` with a second *source type* — `structure` checks over directory layout — and ship the first one: a module-shape check enforcing the canonical `apps/erp/app/modules/*` shape. Reuses Plan 1's baseline + gate verbatim.

**Architecture:** Add a `StructureCheck` type (parallel to the text-scan `ConformanceCheck`), a module-folder loader, and one data-driven `moduleShape` check. The runner gains a `scanModules` pipeline; `newViolations()` unions text + structure findings; the existing baseline + gate test cover both with zero change. Two parallel registries (`CONFORMANCE_CHECKS` for text, `STRUCTURE_CHECKS` for structure) keep each check type trivially simple — no discriminated-union narrowing.

**Grow-friendliness (the explicit design constraint):** A new check = one file + one array entry + re-baseline. A new *rule inside* `moduleShape` = edit a small data array (`REQUIRED_ENTRIES`), not the logic. This is what lets the drift loop (design §5.8) propose extensions as one-line PRs later.

**Tech Stack:** same as Plan 1 (TypeScript, Vitest globals-off, Biome, tsx). Repo enables `noUncheckedIndexedAccess` — guard indexed access in tests (`arr[0]?.prop`).

**Canonical module shape** (verified, 16 modules in `apps/erp/app/modules/*`): exactly one `<name>.service.ts`, one `<name>.models.ts`, one `types.ts`, one `ui/`, one `index.ts`. Allowed (not checked): `*.server.ts`, `*.utils.ts`, `*.test.ts`, other helpers. Existing deviations to baseline: `settings` (extra `backups.service.ts`), `shared` (extra `imports.models.ts`, no `ui/`), `storage-rules` (no `types.ts`).

---

## File Structure
```
packages/core/src/
├── check.ts                       # MODIFY: add ModuleDir + StructureCheck types
├── sources/modules.ts             # NEW: modulesDir(), loadModules()
├── sources/modules.test.ts        # NEW
├── conformance/module-shape.ts    # NEW: the moduleShape StructureCheck (data-driven)
├── conformance/module-shape.test.ts # NEW
├── run.ts                         # MODIFY: STRUCTURE_CHECKS, scanModules(), newViolations() unions both
├── scripts/generate-baseline.ts   # MODIFY: include structure findings
├── conformance/baseline.json      # REGENERATED: now includes structure deviations
└── index.ts                       # MODIFY: export new symbols
```

---

## Task 1: Add `ModuleDir` + `StructureCheck` types

**Files:** Modify `packages/core/src/check.ts` (append; do not change existing `Violation`/`ConformanceCheck`).

- [ ] **Step 1: Append to `src/check.ts`**
```typescript
/** A module folder and its top-level entry names. */
export type ModuleDir = { name: string; dir: string; entries: string[] };

/**
 * A structure check inspects a directory's layout (not file text).
 * `inspect` is PURE: same module in → same violations out. No I/O.
 */
export type StructureCheck = {
  id: string;
  description: string;
  provenance: { deprecates: string; replacedBy: string; since?: string };
  inspect(module: ModuleDir): Violation[];
};
```

- [ ] **Step 2:** `pnpm --filter '@carbon/core' typecheck` → clean.
- [ ] **Step 3:** Commit: `git commit -am "feat(core): add StructureCheck contract"` (only check.ts).

---

## Task 2: Module-folder loader

**Files:** Create `packages/core/src/sources/modules.ts` + `.test.ts`.

- [ ] **Step 1: Write the failing test** `src/sources/modules.test.ts`:
```typescript
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModules } from "./modules";

describe("loadModules", () => {
  it("returns one entry per subdirectory with its top-level names", () => {
    const root = mkdtempSync(join(tmpdir(), "mods-"));
    mkdirSync(join(root, "sales"));
    writeFileSync(join(root, "sales", "sales.service.ts"), "");
    mkdirSync(join(root, "sales", "ui"));
    writeFileSync(join(root, "README.md"), ""); // non-dir ignored
    const mods = loadModules(root);
    expect(mods.map((m) => m.name)).toEqual(["sales"]);
    expect(mods[0]?.entries.sort()).toEqual(["sales.service.ts", "ui"]);
  });
});
```

- [ ] **Step 2:** Run it, confirm FAIL (cannot resolve `./modules`).
- [ ] **Step 3: Write `src/sources/modules.ts`**:
```typescript
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDir } from "../check";

const MODULES_REL = "apps/erp/app/modules";

export function modulesDir(root: string): string {
  return join(root, MODULES_REL);
}

export function loadModules(dir: string): ModuleDir[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, dir: join(dir, name) }))
    .filter((m) => statSync(m.dir).isDirectory())
    .map((m) => ({ name: m.name, dir: m.dir, entries: readdirSync(m.dir) }));
}
```

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5: Sanity check against the real tree:**
`pnpm --filter '@carbon/core' exec tsx -e "import {repoRoot} from './src/sources/migrations.ts'; import {modulesDir,loadModules} from './src/sources/modules.ts'; const m=loadModules(modulesDir(repoRoot())); console.log('modules:', m.length, m.map(x=>x.name).join(','));"`
Expected: ~16 modules including `accounting,sales,inventory,settings,shared,storage-rules`. If not, report.
- [ ] **Step 6:** Commit (the two files): `git commit -m "feat(core): module-folder loader"`.

---

## Task 3: The `moduleShape` structure check (data-driven)

**Files:** Create `packages/core/src/conformance/module-shape.ts` + `.test.ts`.

- [ ] **Step 1: Write the failing test** `src/conformance/module-shape.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import type { ModuleDir } from "../check";
import { moduleShape } from "./module-shape";

const mod = (name: string, entries: string[]): ModuleDir => ({
  name,
  dir: `/x/${name}`,
  entries
});

const COMPLIANT = [
  "sales.service.ts",
  "sales.models.ts",
  "types.ts",
  "ui",
  "index.ts",
  "sales.server.ts" // allowed
];

describe("moduleShape", () => {
  it("passes a compliant module", () => {
    expect(moduleShape.inspect(mod("sales", COMPLIANT))).toHaveLength(0);
  });

  it("flags a missing required entry (types.ts)", () => {
    const v = moduleShape.inspect(
      mod("sales", ["sales.service.ts", "sales.models.ts", "ui", "index.ts"])
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("missing:types.ts");
  });

  it("flags an extra service file", () => {
    const v = moduleShape.inspect(mod("settings", [...COMPLIANT.map((e) => e.replace("sales", "settings")), "backups.service.ts"]));
    expect(v.map((x) => x.snippet)).toContain("extra-service:backups.service.ts");
  });

  it("flags a missing primary service file", () => {
    const v = moduleShape.inspect(
      mod("sales", ["sales.models.ts", "types.ts", "ui", "index.ts"])
    );
    expect(v.map((x) => x.snippet)).toContain("missing:sales.service.ts");
  });

  it("allows multiple .server.ts and utils/test files", () => {
    const v = moduleShape.inspect(
      mod("quality", [
        "quality.service.ts",
        "quality.models.ts",
        "types.ts",
        "ui",
        "index.ts",
        "quality.server.ts",
        "inspectionBalloon.server.ts",
        "quality.utils.ts",
        "quality.utils.test.ts"
      ])
    );
    expect(v).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** Run it, confirm FAIL.
- [ ] **Step 3: Write `src/conformance/module-shape.ts`** (the rule is DATA — edit `REQUIRED_ENTRIES` to grow it):
```typescript
import type { ModuleDir, StructureCheck, Violation } from "../check";

/** Literal entries every module must contain. Edit this to grow the rule. */
const REQUIRED_ENTRIES = ["types.ts", "ui", "index.ts"];

export const moduleShape: StructureCheck = {
  id: "module-shape",
  description:
    "Each ERP module: one <name>.service.ts, one <name>.models.ts, types.ts, ui/, index.ts.",
  provenance: {
    deprecates: "scattered service/models files",
    replacedBy: "one <module>.service.ts + one <module>.models.ts"
  },
  inspect(module): Violation[] {
    const violations: Violation[] = [];
    const add = (snippet: string, message: string) =>
      violations.push({ file: module.name, line: 0, snippet, message });

    for (const name of REQUIRED_ENTRIES) {
      if (!module.entries.includes(name)) {
        add(`missing:${name}`, `Module "${module.name}" is missing ${name}.`);
      }
    }

    for (const kind of ["service", "models"] as const) {
      const expected = `${module.name}.${kind}.ts`;
      const found = module.entries.filter((e) => e.endsWith(`.${kind}.ts`));
      if (!found.includes(expected)) {
        add(`missing:${expected}`, `Module "${module.name}" must have ${expected}.`);
      }
      for (const extra of found.filter((e) => e !== expected)) {
        add(
          `extra-${kind}:${extra}`,
          `Extra ${kind} file "${extra}" — fold into ${expected}.`
        );
      }
    }

    return violations;
  }
};
```

- [ ] **Step 4:** Run test → PASS (5 tests).
- [ ] **Step 5:** Commit (two files): `git commit -m "feat(core): module-shape structure check"`.

---

## Task 4: Wire into runner + baseline; verify gate

**Files:** Modify `packages/core/src/run.ts`, `packages/core/src/scripts/generate-baseline.ts`; regenerate `baseline.json`.

- [ ] **Step 1: Edit `src/run.ts`** — add imports and the structure pipeline, and union both in `newViolations()`. Add:
```typescript
import type { ModuleDir, StructureCheck } from "./check";
import { moduleShape } from "./conformance/module-shape";
import { loadModules, modulesDir } from "./sources/modules";

export const STRUCTURE_CHECKS: StructureCheck[] = [moduleShape];

export function scanModules(
  modules: ModuleDir[],
  checks: StructureCheck[] = STRUCTURE_CHECKS
): Finding[] {
  const out: Finding[] = [];
  for (const m of modules) {
    for (const check of checks) {
      for (const violation of check.inspect(m)) {
        out.push({ checkId: check.id, violation });
      }
    }
  }
  return out;
}
```
Then REPLACE the body of `newViolations()` so it unions text + structure:
```typescript
export function newViolations(): Finding[] {
  const root = repoRoot();
  const findings = [
    ...scanAll(loadSqlFiles(migrationsDir(root))),
    ...scanModules(loadModules(modulesDir(root)))
  ];
  const baseline = loadBaseline();
  return findings.filter((f) => !baseline.has(keyOf(f.checkId, f.violation)));
}
```
(Keep the existing `scanAll`, `CONFORMANCE_CHECKS`, `Finding`, and text imports. Add `migrationsDir`/`repoRoot` are already imported.)

- [ ] **Step 2: Edit `src/scripts/generate-baseline.ts`** to include structure findings:
```typescript
import { keyOf, writeBaseline } from "../baseline";
import { scanAll, scanModules } from "../run";
import { loadModules, modulesDir } from "../sources/modules";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";

const root = repoRoot();
const findings = [
  ...scanAll(loadSqlFiles(migrationsDir(root))),
  ...scanModules(loadModules(modulesDir(root)))
];
const keys = [...new Set(findings.map((f) => keyOf(f.checkId, f.violation)))];
writeBaseline(keys);
console.log(`Wrote ${keys.length} baselined conformance violations.`);
```

- [ ] **Step 3: Typecheck + unit tests** `pnpm --filter '@carbon/core' typecheck` (clean) and `pnpm --filter '@carbon/core' test` (all green — the gate test will still pass only AFTER re-baseline in Step 4; if it fails here naming module-shape violations for settings/shared/storage-rules, that is EXPECTED before re-baselining).

- [ ] **Step 4: Re-baseline** `pnpm --filter '@carbon/core' baseline`. Expect the count to grow from 194 by ~4 (the structure deviations: `module-shape::settings::extra-service:backups.service.ts`, `module-shape::shared::extra-models:imports.models.ts`, `module-shape::shared::missing:ui`, `module-shape::storage-rules::missing:types.ts`). Inspect: `grep module-shape packages/core/src/conformance/baseline.json`.

- [ ] **Step 5: Gate green** `pnpm --filter '@carbon/core' test` → all pass; confirm `newViolations()` is 0 via the gate test.

- [ ] **Step 6: Regression-replay (prove the structure gate works)** — temporarily add an extra service file to a real module:
```bash
touch apps/erp/app/modules/sales/extra.service.ts
```
Run `pnpm --filter '@carbon/core' test -- src/run.test.ts` → the gate FAILS naming `module-shape sales ... extra-service:extra.service.ts`. Capture the output (proof). Then:
```bash
rm apps/erp/app/modules/sales/extra.service.ts
```
Re-run → PASS. Confirm `git status --short` shows no `extra.service.ts`.

- [ ] **Step 7: Commit** `run.ts`, `generate-baseline.ts`, `baseline.json`: `git commit -m "feat(core): wire module-shape into gate + re-baseline"`.

---

## Task 5: Barrel + verify

**Files:** Modify `packages/core/src/index.ts`.

- [ ] **Step 1: Add to the barrel:**
```typescript
export type { ModuleDir, StructureCheck } from "./check";
export { moduleShape } from "./conformance/module-shape";
export { loadModules, modulesDir } from "./sources/modules";
export { STRUCTURE_CHECKS, scanModules } from "./run";
```
- [ ] **Step 2:** `pnpm --filter '@carbon/core' typecheck` (clean), `lint` (clean), `test` (all green).
- [ ] **Step 3: Commit** `git commit -am "feat(core): export module-shape symbols"` (only index.ts).

---

## Self-Review
- Spec coverage: design §5.7 module-shape `structure` check + multi-source net → Tasks 1–4. Grow-friendliness (data-driven `REQUIRED_ENTRIES`, one-file-per-check, parallel registries) → Tasks 1,3.
- Placeholder scan: none.
- Type consistency: `ModuleDir`, `StructureCheck`, `loadModules`, `modulesDir`, `moduleShape`, `scanModules`, `STRUCTURE_CHECKS`, `Finding`, `keyOf` consistent across tasks.
- Landmines: re-baseline must run BEFORE the gate is green (Step 4 before Step 5). `noUncheckedIndexedAccess` → tests use `mods[0]?.entries`, `v[0]?.snippet`. The probe file in Step 6 must be deleted and not committed.
