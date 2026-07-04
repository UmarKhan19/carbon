import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Binding } from "../binding";
import { readLedger } from "../ledger";
import { runLoop } from "./loop";
import type {
  ClaudeRequest,
  ClaudeResult,
  DoerResult,
  JudgeResult,
  RunnerConfig,
  RunnerDeps
} from "./types";

const BINDING: Binding = {
  id: "bug-1",
  kind: "bug",
  title: "off-by-one in total",
  risk: "low",
  acceptance: ["total is correct", "a test covers it"]
};

function jsonText(obj: unknown): string {
  return `done.\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
}
const doer = (d: Partial<DoerResult>) =>
  jsonText({
    change: "fix",
    packages: [],
    testCommand: "",
    touchedUI: false,
    ...d
  });
const judge = (j: Partial<JudgeResult>) =>
  jsonText({ approved: false, unmet: [], feedback: "", ...j });

let dir: string;
let ledgerPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-"));
  ledgerPath = join(dir, "ledger.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeDeps(opts: {
  claude: (req: ClaudeRequest) => ClaudeResult;
  shell?: RunnerDeps["shell"];
  behaviorGate?: RunnerDeps["behaviorGate"];
}): RunnerDeps {
  return {
    claude: opts.claude,
    shell: opts.shell ?? (() => ({ ok: true, output: "" })),
    now: () => "2026-01-01T00:00:00.000Z",
    log: () => undefined,
    ...(opts.behaviorGate ? { behaviorGate: opts.behaviorGate } : {})
  };
}

function makeConfig(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    cwd: dir,
    ledgerPath,
    plateauAfter: 2,
    maxIterations: 8,
    doerMaxTurns: 10,
    doerMaxBudgetUsd: 1,
    judgeMaxTurns: 5,
    judgeMaxBudgetUsd: 1,
    behaviorMaxTurns: 10,
    behaviorMaxBudgetUsd: 1,
    ...over
  };
}

/** Queue doer/judge responses; route by which prompt the loop sent. */
function scriptedClaude(doers: string[], judges: string[]) {
  const d = [...doers];
  const j = [...judges];
  return (req: ClaudeRequest): ClaudeResult => {
    const isDoer = req.prompt.includes("You are the DOER");
    const text = (isDoer ? d.shift() : j.shift()) ?? jsonText({});
    return { text, costUsd: 0, sessionId: "s" };
  };
}

/** Dirty tree by default; named commands can be forced to fail. */
function dirtyShell(fail: string[] = []): RunnerDeps["shell"] {
  return (cmd: string) => {
    if (cmd === "git diff --quiet") return { ok: false, output: "" }; // dirty
    if (fail.some((f) => cmd.includes(f))) return { ok: false, output: "fail" };
    return { ok: true, output: "" };
  };
}

describe("runLoop", () => {
  it("ships when gates pass and the judge approves with nothing unmet", () => {
    const committed: string[] = [];
    const shell: RunnerDeps["shell"] = (cmd) => {
      if (cmd === "git diff --quiet") return { ok: false, output: "" };
      if (cmd.startsWith("git commit")) committed.push(cmd);
      return { ok: true, output: "" };
    };
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ testCommand: "vitest run" })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(1);
    expect(committed).toHaveLength(1);
    const ledger = readLedger(ledgerPath);
    expect(ledger.at(-1)?.decision).toBe("keep");
  });

  it("makes progress then ships once unmet is empty", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({}), doer({})],
        [
          judge({ approved: true, unmet: [1] }),
          judge({ approved: true, unmet: [] })
        ]
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(2);
    expect(
      readLedger(ledgerPath).filter((e) => e.decision === "keep")
    ).toHaveLength(2);
  });

  it("reverts on a failed gate and plateaus after plateauAfter dry iterations", () => {
    const deps = makeDeps({
      claude: scriptedClaude([doer({}), doer({})], []), // judge never reached — gates fail
      shell: dirtyShell(["@carbon/checks test"]) // conformance gate fails
    });

    const out = runLoop(BINDING, makeConfig({ plateauAfter: 2 }), deps);

    expect(out.state).toBe("plateau");
    expect(out.iterations).toBe(2);
    const ledger = readLedger(ledgerPath);
    expect(ledger.every((e) => e.decision === "revert")).toBe(true);
    expect(ledger.at(-1)?.gates.conformance).toBe(false);
  });

  it("blocks when the doer reports it cannot proceed", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ blocked: "need a product decision" })],
        []
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("blocked");
    expect(out.reason).toContain("need a product decision");
  });

  it("blocks a UI change when no behavior gate is wired (milestone 1)", () => {
    const deps = makeDeps({
      claude: scriptedClaude([doer({ touchedUI: true })], []),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("blocked");
    expect(out.reason).toContain("behavior gate");
  });

  it("ships flagged (not reverted) when the behavior gate cannot verify either way", () => {
    const committed: string[] = [];
    const shell: RunnerDeps["shell"] = (cmd) => {
      if (cmd === "git diff --quiet") return { ok: false, output: "" };
      if (cmd.startsWith("git commit")) committed.push(cmd);
      return { ok: true, output: "" };
    };
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ touchedUI: true })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell,
      behaviorGate: () => ({
        passed: false,
        screenshots: [],
        notes: "could not construct a PO with two receipts",
        unverified: "could not construct a PO with two receipts"
      })
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.unverified).toEqual([
      "could not construct a PO with two receipts"
    ]);
    expect(out.reason).toContain("needs human verification");
    expect(committed).toHaveLength(1);
    const last = readLedger(ledgerPath).at(-1);
    expect(last?.decision).toBe("keep");
    expect(last?.unverified).toEqual([
      "could not construct a PO with two receipts"
    ]);
    // The behavior gate must not be recorded as failed — proof was unavailable.
    expect(last?.gates.behavior).toBeUndefined();
  });

  it("reverts when the behavior gate DISPROVES the change (reached the state, still broken)", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ touchedUI: true }), doer({ touchedUI: true })],
        []
      ),
      shell: dirtyShell(),
      behaviorGate: () => ({
        passed: false,
        screenshots: ["bug.png"],
        notes: "reproduced the state; still broken"
      })
    });

    const out = runLoop(BINDING, makeConfig({ plateauAfter: 2 }), deps);

    expect(out.state).toBe("plateau");
    const ledger = readLedger(ledgerPath);
    expect(ledger.every((e) => e.decision === "revert")).toBe(true);
    expect(ledger.at(-1)?.gates.behavior).toBe(false);
  });

  it("ships with open questions when the judge disputes a criterion instead of churning", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ assumptions: ["kept 'Set Quantity' as the default"] })],
        [
          judge({
            approved: true,
            unmet: [],
            disputed: [{ index: 1, question: "is this criterion intentional?" }]
          })
        ]
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.questions).toEqual([
      'Acceptance [1] "a test covers it": is this criterion intentional?',
      "Assumption: kept 'Set Quantity' as the default"
    ]);
  });

  it("runs the behavior gate for UI changes when wired", () => {
    let called = 0;
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ touchedUI: true })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell: dirtyShell(),
      behaviorGate: () => {
        called++;
        return { passed: true, screenshots: ["a.png"], notes: "ok" };
      }
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(called).toBe(1);
    expect(out.state).toBe("shipped");
    expect(readLedger(ledgerPath).at(-1)?.gates.behavior).toBe(true);
  });
});
