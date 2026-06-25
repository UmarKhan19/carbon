# Plan 3: Conductor v1 — `@carbon/harness` + `build` skill (supervised)

> **For agentic workers:** Use superpowers:subagent-driven-development for the code tasks. Steps use `- [ ]`.

**Goal:** A supervised loop conductor. A thin, unit-testable `@carbon/harness` package (binding parser, ledger, floor-gate runner, status) + a `build` skill that drives the doer→gate→keep/revert→ledger→finish cycle while a human watches, landing a gated PR.

**Architecture:** The deterministic substrate is code in `@carbon/harness`; the non-deterministic orchestration is the `build` skill. The harness's gate runner shells out to the four `@carbon/checks` checks (the *checker*); the skill is the *doer + decision*. v1 gate ladder = **floor** (lint + conformance + clobbers) + a **judge** self-review subagent. Supervised: the human is the final approver; no scheduling/worktree-fanout/autonomy yet.

**Grow-friendliness:** gates are a data list (`FLOOR_GATES`), binding fields are frontmatter, the runner takes an injected `exec` so it's pure/testable. Add a gate = one array entry. Add a binding field = one frontmatter key. TDD/behavior/judge gates and autonomy grow later without reshaping this.

**Tech Stack:** TypeScript, Vitest globals-off, Biome, tsx, `node:child_process`. `noUncheckedIndexedAccess` ON. Dependency-free binding parser (no YAML lib).

**Scope boundary (v1 NOT included):** autonomous/overnight scheduling, `crbn` worktree fan-out, risk-policy Interviewer, declarative DOT pipelines for features, checkpoint/resume, TDD-mandatory + calibrated-judge gates. Those are later plans; v1 is the smallest *runnable* supervised loop. **Visual e2e behavior verification IS in v1** — a UI change is never done without booting the stack and confirming it in the running app (mandatory behavior gate; see the conductor skill §2b).

---

## File Structure
```
packages/harness/
├── package.json, tsconfig.json, vitest.config.ts, README.md
└── src/
    ├── binding.ts / binding.test.ts      # Binding type + parseBinding (frontmatter, no deps)
    ├── ledger.ts / ledger.test.ts        # LedgerEntry + appendLedger/readLedger (jsonl)
    ├── gates.ts / gates.test.ts          # Gate/GateResult + runGates(injected exec) + FLOOR_GATES
    ├── scripts/run-gates.ts              # CLI: run FLOOR_GATES, print, exit code
    └── index.ts                          # barrel
.claude/skills/build/SKILL.md             # the conductor skill
llm/loops/                                # binding + ledger home (created on first use)
```

---

## Task 0: Scaffold `@carbon/harness`
Mirror `@carbon/checks`'s scaffold exactly (it is the known-good template).
- [ ] **Step 1:** Create `packages/harness/package.json`:
```json
{
  "name": "@carbon/harness",
  "version": "0.0.0",
  "private": true,
  "sideEffects": false,
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "clean": "rimraf .turbo node_modules dist",
    "lint": "biome lint --write ",
    "test": "vitest run",
    "typecheck": "tsgo --noEmit",
    "gates": "tsx src/scripts/run-gates.ts"
  },
  "devDependencies": {
    "@carbon/config": "workspace:*",
    "@types/node": "^22",
    "rimraf": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```
- [ ] **Step 2:** `tsconfig.json` = `{ "extends": "@carbon/config/tsconfig/react-library.json", "include": ["src"], "exclude": ["dist","build","node_modules"] }`; `vitest.config.ts` = `export { default } from "@carbon/config/vitest";`; `src/index.ts` = `export {};`; `src/smoke.test.ts` = a 1-assert vitest test importing `{describe,expect,it}` from "vitest".
- [ ] **Step 3:** `pnpm install`; `pnpm --filter '@carbon/harness' test` (1 pass); `typecheck` clean.
- [ ] **Step 4:** Commit `git add packages/harness pnpm-lock.yaml && git commit -m "feat(harness): scaffold @carbon/harness"`.

---

## Task 1: Binding parser (dependency-free frontmatter), TDD
- [ ] **Step 1:** Test `src/binding.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { parseBinding } from "./binding";

const MD = `---
id: bug-reorder
kind: bug
title: Reorder button misaligns
risk: low
acceptance:
- Button centers at <640px
- No console errors
---
Some freeform notes.`;

describe("parseBinding", () => {
  it("parses scalar fields and the acceptance list", () => {
    const b = parseBinding(MD);
    expect(b.id).toBe("bug-reorder");
    expect(b.kind).toBe("bug");
    expect(b.title).toBe("Reorder button misaligns");
    expect(b.risk).toBe("low");
    expect(b.acceptance).toEqual(["Button centers at <640px", "No console errors"]);
  });

  it("throws on missing required fields", () => {
    expect(() => parseBinding("---\nkind: bug\n---")).toThrow(/id/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `src/binding.ts`:
```typescript
export type LoopKind = "bug" | "feature" | "usability" | "copy";

export type Binding = {
  id: string;
  kind: LoopKind;
  title: string;
  risk: "low" | "med" | "high";
  acceptance: string[];
};

const KINDS: LoopKind[] = ["bug", "feature", "usability", "copy"];

/** Parse the YAML-ish frontmatter of a `.loop.md` binding. No YAML dependency. */
export function parseBinding(md: string): Binding {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) throw new Error("Binding has no frontmatter block.");
  const lines = match[1].split("\n");
  const scalars: Record<string, string> = {};
  const acceptance: string[] = [];
  let inAcceptance = false;
  for (const line of lines) {
    if (/^acceptance:\s*$/.test(line)) {
      inAcceptance = true;
      continue;
    }
    if (inAcceptance && /^\s*-\s+/.test(line)) {
      acceptance.push(line.replace(/^\s*-\s+/, "").trim());
      continue;
    }
    inAcceptance = false;
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv && kv[1] && kv[2] !== undefined) scalars[kv[1]] = kv[2].trim();
  }
  const id = scalars.id;
  const kind = scalars.kind as LoopKind;
  if (!id) throw new Error("Binding missing required field: id");
  if (!kind || !KINDS.includes(kind)) throw new Error(`Binding kind must be one of ${KINDS.join("|")}`);
  return {
    id,
    kind,
    title: scalars.title ?? "",
    risk: (scalars.risk as Binding["risk"]) ?? "low",
    acceptance
  };
}
```
- [ ] **Step 4:** Run → PASS (2 tests). `typecheck` clean. Commit two files: `git commit -m "feat(harness): binding parser"`.

---

## Task 2: Ledger (append-only jsonl), TDD
- [ ] **Step 1:** Test `src/ledger.test.ts`:
```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendLedger, readLedger, type LedgerEntry } from "./ledger";

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  iteration: 1,
  change: "centered the button",
  gates: { lint: true, conformance: true },
  decision: "keep",
  reason: "all floor gates green",
  at: "2026-06-25T00:00:00Z",
  ...over
});

describe("ledger", () => {
  it("appends entries and reads them back in order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "led-")), "ledger.jsonl");
    appendLedger(path, entry({ iteration: 1 }));
    appendLedger(path, entry({ iteration: 2, decision: "revert" }));
    const all = readLedger(path);
    expect(all.map((e) => e.iteration)).toEqual([1, 2]);
    expect(all[1]?.decision).toBe("revert");
  });

  it("reads an empty/missing ledger as []", () => {
    expect(readLedger(join(tmpdir(), "nope-ledger.jsonl"))).toEqual([]);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `src/ledger.ts`:
```typescript
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LedgerEntry = {
  iteration: number;
  change: string;
  gates: Record<string, boolean>;
  decision: "keep" | "revert";
  reason: string;
  /** ISO timestamp, supplied by the caller (the harness has no clock). */
  at: string;
};

export function appendLedger(path: string, entry: LedgerEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readLedger(path: string): LedgerEntry[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}
```
- [ ] **Step 4:** Run → PASS (2). `typecheck` clean. Commit: `git commit -m "feat(harness): append-only ledger"`.

---

## Task 3: Gate runner (injected exec) + CLI, TDD
- [ ] **Step 1:** Test `src/gates.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { type Exec, FLOOR_GATES, runGates } from "./gates";

describe("runGates", () => {
  it("runs each gate via the injected exec and reports pass/fail", () => {
    const exec: Exec = (cmd) => ({ ok: !cmd.includes("clobbers"), output: cmd });
    const gates = [
      { id: "lint", cmd: "biome check" },
      { id: "clobbers", cmd: "pnpm clobbers" }
    ];
    const results = runGates(gates, exec);
    expect(results).toEqual([
      { id: "lint", passed: true, output: "biome check" },
      { id: "clobbers", passed: false, output: "pnpm clobbers" }
    ]);
  });

  it("ships a non-empty FLOOR_GATES list", () => {
    expect(FLOOR_GATES.length).toBeGreaterThan(0);
    expect(FLOOR_GATES.every((g) => g.id && g.cmd)).toBe(true);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `src/gates.ts`:
```typescript
export type Gate = { id: string; cmd: string };
export type GateResult = { id: string; passed: boolean; output: string };
export type Exec = (cmd: string) => { ok: boolean; output: string };

/** The v1 floor: cheap, deterministic, reuses the @carbon/checks checks. Add a row to grow. */
export const FLOOR_GATES: Gate[] = [
  { id: "lint", cmd: "pnpm exec biome check" },
  { id: "conformance", cmd: "pnpm --filter @carbon/checks test" },
  { id: "clobbers", cmd: "pnpm --filter @carbon/checks clobbers" }
];

export function runGates(gates: Gate[], exec: Exec): GateResult[] {
  return gates.map((g) => {
    const r = exec(g.cmd);
    return { id: g.id, passed: r.ok, output: r.output };
  });
}
```
- [ ] **Step 4:** Run → PASS (2). Then write the CLI `src/scripts/run-gates.ts`:
```typescript
import { execSync } from "node:child_process";
import { FLOOR_GATES, runGates } from "../gates";

const results = runGates(FLOOR_GATES, (cmd) => {
  try {
    return { ok: true, output: execSync(cmd, { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
});
let failed = 0;
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.id}`);
  if (!r.passed) failed++;
}
console.log(`\n${results.length - failed}/${results.length} floor gates green.`);
process.exit(failed > 0 ? 1 : 0);
```
- [ ] **Step 5:** `typecheck` clean, `lint` clean. Commit `src/gates.ts`, `src/gates.test.ts`, `src/scripts/run-gates.ts`: `git commit -m "feat(harness): floor-gate runner + CLI"`.

---

## Task 4: Barrel + README + verify
- [ ] **Step 1:** `src/index.ts`:
```typescript
export { type Binding, type LoopKind, parseBinding } from "./binding";
export { appendLedger, type LedgerEntry, readLedger } from "./ledger";
export { type Exec, FLOOR_GATES, type Gate, type GateResult, runGates } from "./gates";
```
- [ ] **Step 2:** README documenting: the harness powers the `build` skill; bindings live in `llm/loops/<id>.loop.md`; ledger in `llm/loops/<id>/ledger.jsonl`; run floor gates via `pnpm --filter @carbon/harness gates`; grow gates via `FLOOR_GATES`.
- [ ] **Step 3:** `typecheck` clean, `lint` clean, `test` all green. Commit: `git commit -am "feat(harness): barrel + README"`.

---

## Task 5: The `build` skill (written directly, not TDD)
Create `.claude/skills/build/SKILL.md` — the supervised conductor. It MUST encode:
- **Input:** a binding (`llm/loops/<id>.loop.md`) OR an inline request the skill first writes into a binding (parse with `@carbon/harness` `parseBinding`).
- **Cycle (supervised, human watching):** repeat until acceptance met or the human stops:
  1. **Doer** — make the *smallest* change toward the weakest-covered acceptance criterion. For UI, FIRST retrieve and cite the nearest existing precedent screen (copy it, don't invent); for ERP-domain features, FIRST run `research`.
  2. **Floor gates** — run `pnpm --filter @carbon/harness gates` (lint + conformance + clobbers); for the touched package(s) also run `typecheck`. If any fail, fix or revert.
  3. **Judge** — dispatch a separate review subagent (not the doer) to check the diff against the acceptance criteria; it can send work back.
  4. **Decide** — keep iff all gates green + judge approves, else revert. Append a `LedgerEntry` to `llm/loops/<id>/ledger.jsonl` (timestamp supplied by the skill).
  5. **Terminate** — acceptance met → finish; or the human stops.
- **Finish:** for net-new UI, capture agent-browser screenshots; open a **gated PR via `gh`** (never auto-merge) whose body cites which gate proves each criterion + the design rationale/precedent; summarize the ledger.
- **Guardrails:** never run on `main`; surface every design change for human approve/comment/improve; regenerate types after schema changes before typecheck; one service/models per module.

(No automated test for the skill — it is validated by a real run, Task 6.)
- [ ] Commit: `git add .claude/skills/build && git commit -m "feat(build): supervised conductor skill"`.

---

## Task 6: Validation run (manual, supervised — do with the user)
Pick a tiny, safe, reversible item (a copy tweak or a one-line bug). Write its binding, invoke `/build`, watch one full cycle, and confirm it produces a correct **gated PR** with a populated ledger. This is the conductor's real "done" (spec M2). Do NOT mark Plan 3 complete until one supervised loop has produced a gated PR.

---

## Self-Review
- Spec coverage: §4.2 cycle → skill (Task 5); §6 typed contracts / status → harness types; gate ladder floor → Task 3; ledger §5.4 → Task 2; binding §4.1 → Task 1; PR/screenshots/gh §7.2 → skill finish.
- Type consistency: `Binding`, `LoopKind`, `parseBinding`, `LedgerEntry`, `appendLedger`, `readLedger`, `Gate`, `GateResult`, `Exec`, `runGates`, `FLOOR_GATES` consistent across tasks + barrel.
- Landmines: `noUncheckedIndexedAccess` → tests use `all[1]?.decision`, `results[0]`. The harness has no clock — `at` is always supplied by the caller. The gate runner stays pure (injected `exec`); only the CLI shells out. The skill must not run on `main`.
