import { describe, expect, it } from "vitest";
import type { Binding } from "../binding";
import { buildPlan, parsePlanResult } from "./plan";
import type { ClaudeResult, RunnerConfig, RunnerDeps } from "./types";

const BINDING: Binding = {
  id: "feat-1",
  kind: "feature",
  title: "period close",
  risk: "med",
  acceptance: ["migration", "service", "UI", "docs"]
};

const SMALL: Binding = { ...BINDING, acceptance: ["one", "two"] };

function json(obj: unknown): string {
  return `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
}

function deps(claude: () => ClaudeResult): RunnerDeps {
  return {
    claude,
    shell: () => ({ ok: true, output: "" }),
    now: () => "t",
    log: () => undefined
  };
}

const config = {
  cwd: "/tmp",
  ledgerPath: "/tmp/l.jsonl",
  taskMaxAttempts: 3,
  maxIterations: 16,
  plannerMaxTurns: 5,
  plannerMaxBudgetUsd: 1,
  doerMaxTurns: 1,
  doerMaxBudgetUsd: 1,
  judgeMaxTurns: 1,
  judgeMaxBudgetUsd: 1,
  behaviorMaxTurns: 1,
  behaviorMaxBudgetUsd: 1
} satisfies RunnerConfig;

describe("parsePlanResult", () => {
  it("parses tasks and appends a catch-all for uncovered criteria", () => {
    const tasks = parsePlanResult(
      json({
        tasks: [
          { title: "migration", detail: "d", criteria: [0] },
          { title: "service", detail: "d", criteria: [1, 2] }
        ]
      }),
      BINDING
    );
    expect(tasks.map((t) => t.title)).toEqual([
      "migration",
      "service",
      "Remaining acceptance criteria"
    ]);
    expect(tasks.at(-1)?.criteria).toEqual([3]);
  });

  it("drops out-of-range criteria and junk entries", () => {
    const tasks = parsePlanResult(
      json({
        tasks: [
          { title: "ok", detail: "d", criteria: [0, 99, -1, 1, 2, 3] },
          { detail: "no title" },
          "garbage"
        ]
      }),
      BINDING
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
  });

  it("degrades to one whole-binding task when the planner output is unusable", () => {
    for (const text of ["no json here", json({ tasks: [] }), json({})]) {
      const tasks = parsePlanResult(text, BINDING);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
    }
  });
});

describe("buildPlan", () => {
  it("skips the planner session entirely for loop-sized bindings (≤2 criteria)", () => {
    let called = 0;
    const tasks = buildPlan(
      SMALL,
      config,
      deps(() => {
        called++;
        return { text: "", costUsd: 0, sessionId: "s" };
      })
    );
    expect(called).toBe(0);
    expect(tasks).toHaveLength(1);
  });

  it("never lets a planner crash kill the run — falls back to one task", () => {
    const tasks = buildPlan(
      BINDING,
      config,
      deps(() => {
        throw new Error("claude failed to spawn");
      })
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
  });
});
