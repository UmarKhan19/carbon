# Plan 1c: Clobber Check (concurrent redefinition)

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add a "clobber" check to `@carbon/checks` that flags any full-redefinition DB object (view, function, `attach_event_trigger`, RLS policy) redefined on **both** the PR branch and `main` since their merge-base — the silent regression where two branches each add a separate migration redefining the same object, git merges cleanly, and the later apply clobbers the earlier.

**Architecture:** Pure core — `objectRefs(sql)` extracts redefined object identifiers (data-driven regex list), `findClobbers(branchFiles, mainFiles)` returns the intersection — unit-tested with inline fixtures, no git. A thin git CLI (`scripts/check-clobbers.ts`) computes the merge-base with `origin/main`, gathers the migration files changed on each side, reads their contents, and runs `findClobbers`. Mirrors the invariant net's pure-core + thin-IO-wrapper split.

**Grow-friendliness:** the set of "what is a redefinition" is the `OBJECT_PATTERNS` array — add a regex to cover a new object kind. No logic changes.

**Runtime:** runs at PR time (needs `origin/main`), via the CLI — not the static `test` job (which has no branch context). Plan 1c builds the mechanism; wiring it into CI/the loop is a later step.

**Tech Stack:** TypeScript, Vitest globals-off, Biome, tsx, `node:child_process` for git. `noUncheckedIndexedAccess` ON.

---

## File Structure
```
packages/checks/src/
├── clobber.ts                 # NEW: objectRefs(), findClobbers()  (pure)
├── clobber.test.ts            # NEW: unit tests, inline fixtures
├── scripts/check-clobbers.ts  # NEW: git-aware CLI
└── index.ts                   # MODIFY: export clobber symbols
```

---

## Task 1: Pure core — `objectRefs` + `findClobbers`

**Files:** Create `packages/checks/src/clobber.ts` + `packages/checks/src/clobber.test.ts`. Reuses `Violation` from `./check`.

- [ ] **Step 1: Write the failing test** `src/clobber.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { findClobbers, objectRefs } from "./clobber";

describe("objectRefs", () => {
  it("extracts views, functions, and event-trigger redefinitions", () => {
    const sql = `
      CREATE OR REPLACE VIEW "salesOrders" AS SELECT * FROM x;
      CREATE OR REPLACE FUNCTION get_total() RETURNS int AS $$ $$;
      SELECT attach_event_trigger('job', ARRAY[]::text[]);
    `;
    expect(objectRefs(sql)).toEqual(
      new Set(["view:salesOrders", "function:get_total", "event-trigger:job"])
    );
  });

  it("ignores non-redefining SQL", () => {
    expect(objectRefs("SELECT 1; INSERT INTO t VALUES (1);").size).toBe(0);
  });
});

describe("findClobbers", () => {
  it("flags an object redefined on both sides", () => {
    const branch = [{ file: "b.sql", contents: 'CREATE OR REPLACE VIEW "v" AS SELECT 1;' }];
    const main = [{ file: "m.sql", contents: 'CREATE OR REPLACE VIEW "v" AS SELECT 2;' }];
    const v = findClobbers(branch, main);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("view:v");
    expect(v[0]?.file).toBe("b.sql");
    expect(v[0]?.message).toContain("m.sql");
  });

  it("does not flag disjoint redefinitions", () => {
    const branch = [{ file: "b.sql", contents: 'CREATE OR REPLACE VIEW "a" AS SELECT 1;' }];
    const main = [{ file: "m.sql", contents: 'CREATE OR REPLACE VIEW "b" AS SELECT 2;' }];
    expect(findClobbers(branch, main)).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter '@carbon/checks' test -- src/clobber.test.ts` → FAIL.

- [ ] **Step 3: Write `src/clobber.ts`**:
```typescript
import type { Violation } from "./check";

export type SourceFile = { file: string; contents: string };

/** Patterns that identify a FULL redefinition of a DB object. Add a row to grow coverage. */
const OBJECT_PATTERNS: { kind: string; re: RegExp }[] = [
  {
    kind: "view",
    re: /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?/gi
  },
  {
    kind: "function",
    re: /create\s+or\s+replace\s+function\s+"?([a-zA-Z0-9_]+)"?/gi
  },
  {
    kind: "event-trigger",
    re: /attach_event_trigger\(\s*'([a-zA-Z0-9_]+)'/gi
  }
];

/** The set of `kind:name` objects redefined by a SQL string. */
export function objectRefs(sql: string): Set<string> {
  const refs = new Set<string>();
  for (const { kind, re } of OBJECT_PATTERNS) {
    for (const m of sql.matchAll(re)) {
      if (m[1]) refs.add(`${kind}:${m[1]}`);
    }
  }
  return refs;
}

function refMap(files: SourceFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    for (const ref of objectRefs(f.contents)) {
      if (!map.has(ref)) map.set(ref, f.file);
    }
  }
  return map;
}

/** Objects redefined on BOTH sides since the merge-base = clobber risk. */
export function findClobbers(
  branch: SourceFile[],
  main: SourceFile[]
): Violation[] {
  const mainRefs = refMap(main);
  const violations: Violation[] = [];
  for (const [ref, branchFile] of refMap(branch)) {
    const mainFile = mainRefs.get(ref);
    if (mainFile) {
      violations.push({
        file: branchFile,
        line: 0,
        snippet: ref,
        message: `Clobber risk: "${ref}" is redefined on this branch (${branchFile}) and on main (${mainFile}) since the merge-base. Rebase and re-fork your redefinition from main's latest version.`
      });
    }
  }
  return violations;
}
```

- [ ] **Step 4:** Run test → PASS (4 tests). Then `pnpm --filter '@carbon/checks' typecheck` (clean).
- [ ] **Step 5:** Commit the two files: `git commit -m "feat(core): clobber-detection core (concurrent redefinition)"`.

---

## Task 2: The git CLI

**Files:** Create `packages/checks/src/scripts/check-clobbers.ts`; add a `clobbers` script to `packages/checks/package.json`.

- [ ] **Step 1: Add script** to `packages/checks/package.json`: `"clobbers": "tsx src/scripts/check-clobbers.ts"`.

- [ ] **Step 2: Write `src/scripts/check-clobbers.ts`**:
```typescript
import { execFileSync } from "node:child_process";
import { findClobbers, type SourceFile } from "../clobber";
import { repoRoot } from "../sources/migrations";

const MIGRATIONS = "packages/database/supabase/migrations";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Files under MIGRATIONS that differ between `ref` and the working/other ref, read at `readRef`. */
function filesChanged(root: string, base: string, head: string): string[] {
  const out = git(root, ["diff", "--name-only", "--diff-filter=AM", `${base}...${head}`, "--", MIGRATIONS]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function readAt(root: string, ref: string, path: string): SourceFile | null {
  try {
    return { file: path.replace(`${MIGRATIONS}/`, ""), contents: git(root, ["show", `${ref}:${path}`]) };
  } catch {
    return null; // deleted at that ref
  }
}

function main() {
  const root = repoRoot();
  const mainRef = process.env.CLOBBER_BASE_REF ?? "origin/main";
  let base: string;
  try {
    base = git(root, ["merge-base", "HEAD", mainRef]);
  } catch {
    console.error(`Could not compute merge-base with ${mainRef}. Fetch it first (git fetch origin main).`);
    process.exit(2);
    return;
  }
  const branchFiles = filesChanged(root, base, "HEAD")
    .map((p) => readAt(root, "HEAD", p))
    .filter((f): f is SourceFile => f !== null);
  const mainFiles = filesChanged(root, base, mainRef)
    .map((p) => readAt(root, mainRef, p))
    .filter((f): f is SourceFile => f !== null);

  const clobbers = findClobbers(branchFiles, mainFiles);
  if (clobbers.length === 0) {
    console.log(`No clobber risks vs ${mainRef} (merge-base ${base.slice(0, 9)}).`);
    process.exit(0);
  }
  for (const c of clobbers) console.log(`CLOBBER  ${c.snippet}\n  ${c.message}`);
  process.exit(1);
}

main();
```

- [ ] **Step 3:** `pnpm --filter '@carbon/checks' typecheck` (clean), `lint` (clean).

- [ ] **Step 4: Live smoke run** (we are on a real branch with `origin/main`): `pnpm --filter '@carbon/checks' clobbers`. Expected on `feat/loops`: `No clobber risks vs origin/main ...` (this branch adds no view/function redefinitions). If `origin/main` isn't present, run `git fetch origin main` first. Report the output. (This proves the git plumbing works end-to-end; the *detection* itself is proven by the unit tests.)

- [ ] **Step 5:** Commit: `git add packages/checks/package.json packages/checks/src/scripts/check-clobbers.ts && git commit -m "feat(core): clobber-check git CLI"`.

---

## Task 3: Barrel + README + verify

- [ ] **Step 1: Append to `src/index.ts`:**
```typescript
export { findClobbers, objectRefs, type SourceFile } from "./clobber";
```
- [ ] **Step 2: Add a README section** documenting: clobber = same object redefined on branch + main since merge-base; run via `pnpm --filter @carbon/checks clobbers`; grow coverage by adding to `OBJECT_PATTERNS`; runs at PR time, not the static gate.
- [ ] **Step 3:** `pnpm --filter '@carbon/checks' typecheck` (clean), `lint` (clean), `test` (all green).
- [ ] **Step 4:** Commit: `git commit -am "feat(core): export clobber check + README"`.

---

## Self-Review
- Spec coverage: design §5.7 git-diff/clobber check → Tasks 1–2; grow-friendliness (`OBJECT_PATTERNS` data list) → Task 1.
- Type consistency: `objectRefs`, `findClobbers`, `SourceFile`, `Violation` consistent.
- Landmines: the clobber check must NOT run in the package `test` script (needs branch/git context) — only the CLI. `noUncheckedIndexedAccess` → tests use `v[0]?.snippet`. The CLI's `git show main:path` may fail for files that don't exist at that ref — handled by `readAt` returning null. Live run needs `origin/main` fetched.
