import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { parseBinding } from "../binding";
import * as layout from "../layout";
import { readLedger } from "../ledger";
import { behaviorGate } from "../runner/behavior";
import { claude } from "../runner/claude";
import { runLoop } from "../runner/loop";
import { openPr } from "../runner/pr";
import { shell } from "../runner/shell";
import { DEFAULT_CONFIG, type RunnerConfig } from "../runner/types";

// Usage: tsx src/scripts/run-loop.ts <binding.loop.md> [--cwd <worktree>] [--no-pr] [--doer-budget <usd>] [--judge-budget <usd>] [--judge-turns <n>]
//
// Milestone 1: run inside a worktree you already created (`crbn new` + `crbn up`)
// and pass it via --cwd. Drives one binding to a gated PR, fully unattended.
const argv = process.argv.slice(2);
const bindingPath = argv.find((a) => !a.startsWith("--"));
if (!bindingPath) {
  console.error(
    "usage: run-loop <binding.loop.md> [--cwd <worktree>] [--no-pr]"
  );
  process.exit(2);
}

const cwdIdx = argv.indexOf("--cwd");
const cwdArg = cwdIdx >= 0 ? argv[cwdIdx + 1] : undefined;
const cwd = resolve(
  cwdArg && !cwdArg.startsWith("--") ? cwdArg : process.cwd()
);
const noPr = argv.includes("--no-pr");

// Optional budget/turn overrides (e.g. --doer-budget 10 for complex features, --judge-budget 5 for many criteria)
const doerBudgetIdx = argv.indexOf("--doer-budget");
const doerBudgetOverride =
  doerBudgetIdx >= 0 ? parseFloat(argv[doerBudgetIdx + 1] ?? "") : NaN;

const judgeBudgetIdx = argv.indexOf("--judge-budget");
const judgeBudgetOverride =
  judgeBudgetIdx >= 0 ? parseFloat(argv[judgeBudgetIdx + 1] ?? "") : NaN;

const judgeTurnsIdx = argv.indexOf("--judge-turns");
const judgeTurnsOverride =
  judgeTurnsIdx >= 0 ? parseInt(argv[judgeTurnsIdx + 1] ?? "", 10) : NaN;

const bindingMd = readFileSync(resolve(bindingPath), "utf8");
const binding = parseBinding(bindingMd);

// All artifacts live under one gitignored, harness-owned run dir (see layout.ts).
mkdirSync(layout.runDir(cwd, binding.id), { recursive: true });
// Persist the binding so the run is self-describing (inspection / re-entry).
writeFileSync(layout.bindingPath(cwd, binding.id), bindingMd);

const ledgerPath = layout.ledgerPath(cwd, binding.id);
const logPath = layout.logPath(cwd, binding.id);

const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  console.log(line);
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    /* logging is best-effort */
  }
};

const config: RunnerConfig = {
  ...DEFAULT_CONFIG,
  cwd,
  ledgerPath,
  ...(Number.isFinite(doerBudgetOverride)
    ? { doerMaxBudgetUsd: doerBudgetOverride }
    : {}),
  ...(Number.isFinite(judgeBudgetOverride)
    ? { judgeMaxBudgetUsd: judgeBudgetOverride }
    : {}),
  ...(Number.isFinite(judgeTurnsOverride)
    ? { judgeMaxTurns: judgeTurnsOverride }
    : {})
};

const outcome = runLoop(binding, config, {
  claude,
  shell,
  now: () => new Date().toISOString(),
  log,
  behaviorGate
});

// Open a PR whenever there is kept, gate-green work — shipped runs always, and
// non-shipped runs (plateau/blocked) as a SALVAGE draft. Kept commits already
// passed every floor gate and judge review; discarding them with the worktree
// wastes the spend. Unproven work goes up flagged, never silently dropped.
const keptCommits = readLedger(ledgerPath).some((e) => e.decision === "keep");
if (!noPr && (outcome.state === "shipped" || keptCommits)) {
  const url = openPr(binding, ledgerPath, shell, cwd, {
    ...(outcome.unverified ? { unverified: outcome.unverified } : {}),
    ...(outcome.questions ? { questions: outcome.questions } : {}),
    ...(outcome.state !== "shipped"
      ? { partial: { state: outcome.state, reason: outcome.reason } }
      : {})
  });
  outcome.prUrl = url;
  log({ event: "pr", url, partial: outcome.state !== "shipped" });
  console.log(`\nPR: ${url}`);
}

log({ event: "outcome", ...outcome });
// Structured result an external orchestrator reads instead of scraping stdout.
writeFileSync(
  layout.outcomePath(cwd, binding.id),
  `${JSON.stringify(outcome, null, 2)}\n`
);

process.exit(outcome.state === "shipped" ? 0 : 1);
