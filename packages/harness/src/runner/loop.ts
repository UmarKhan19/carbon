import type { Binding } from "../binding";
import { FLOOR_GATES, runGates } from "../gates";
import { appendLedger, readLedger } from "../ledger";
import {
  buildDoerPrompt,
  buildJudgePrompt,
  parseDoerResult,
  parseJudgeResult
} from "./prompts";
import { sq } from "./shell";
import type {
  JudgeResult,
  LoopOutcome,
  RunnerConfig,
  RunnerDeps,
  Shell
} from "./types";

/** Is the working tree dirty? `git diff --quiet` exits non-zero when it is. */
function isDirty(shell: Shell, cwd: string): boolean {
  return !shell("git diff --quiet", { cwd }).ok;
}

function commit(shell: Shell, cwd: string, message: string): void {
  shell("git add -A", { cwd });
  // sq() single-quotes the message — the doer's summary may contain backticks/$.
  shell(`git commit -m ${sq(message)}`, { cwd });
}

/** Discard the current iteration's uncommitted work. Ignored files (the ledger) survive. */
function revert(shell: Shell, cwd: string): void {
  shell("git checkout -- .", { cwd });
  shell("git clean -fd", { cwd });
}

function revertReason(
  gates: Record<string, boolean>,
  judge: JudgeResult
): string {
  const failed = Object.entries(gates)
    .filter(([, ok]) => !ok)
    .map(([id]) => id);
  if (failed.length > 0) return `gates failed: ${failed.join(", ")}`;
  if (!judge.approved) return `judge rejected: ${judge.feedback}`;
  return "reverted";
}

/**
 * Drive ONE work item through the conductor cycle to a green committed state,
 * fully unattended. This is the deterministic spine of the conductor skill,
 * promoted out of prose into code: the loop owns worktree state, gate execution,
 * keep/revert, the ledger, and the terminal-state machine; the model is invoked
 * only for the three judgment steps (doer, behavior, judge).
 *
 * Pure w.r.t. the outside world — every side effect goes through `deps`. The
 * caller (the script) creates the worktree and, on a `shipped` outcome, opens
 * the PR. This function never merges and never runs on `main`.
 */
export function runLoop(
  binding: Binding,
  config: RunnerConfig,
  deps: RunnerDeps
): LoopOutcome {
  const { claude, shell, now, log } = deps;
  const { cwd, ledgerPath } = config;
  let iteration = 0;
  let sinceKeep = 0;
  // Proof gaps on KEPT work and product questions raised along the way — both
  // ride the outcome so the PR/issue gets flagged instead of the work vanishing.
  const unverified: string[] = [];
  const questions: string[] = [];

  const end = (state: LoopOutcome["state"], reason: string): LoopOutcome => {
    log({
      event: "loop:end",
      state,
      reason,
      iterations: iteration,
      unverified: unverified.length,
      questions: questions.length
    });
    return {
      state,
      iterations: iteration,
      reason,
      ...(unverified.length > 0
        ? { unverified: [...new Set(unverified)] }
        : {}),
      ...(questions.length > 0 ? { questions: [...new Set(questions)] } : {})
    };
  };

  while (iteration < config.maxIterations) {
    iteration++;
    try {
      const ledger = readLedger(ledgerPath);
      log({ event: "iteration:start", iteration });

      // 1. DOER — smallest change toward the weakest criterion.
      const doerRes = claude({
        prompt: buildDoerPrompt(binding, ledger),
        cwd,
        maxTurns: config.doerMaxTurns,
        maxBudgetUsd: config.doerMaxBudgetUsd
      });
      const doer = parseDoerResult(doerRes.text);
      log({
        event: "doer",
        iteration,
        change: doer.change,
        cost: doerRes.costUsd
      });

      if (doer.blocked) {
        revert(shell, cwd);
        return end("blocked", `doer blocked: ${doer.blocked}`);
      }

      // The doer may have decided nothing was needed. If the tree is clean, the
      // only question left is "are we done?" — let the judge confirm.
      const dirty = isDirty(shell, cwd);

      const gates: Record<string, boolean> = {};
      // Proof gaps THIS iteration (behavior gate couldn't verify either way).
      const iterUnverified: string[] = [];
      if (dirty) {
        // 2. FLOOR GATES (lint + conformance + clobbers) and per-package typecheck.
        const floor = config.gates ?? FLOOR_GATES;
        for (const r of runGates(floor, (cmd) => shell(cmd, { cwd }))) {
          gates[r.id] = r.passed;
        }
        for (const pkg of doer.packages) {
          gates[`typecheck:${pkg}`] = shell(`pnpm --filter ${pkg} typecheck`, {
            cwd
          }).ok;
        }

        // 3. BEHAVIOR GATE — UI changes are not done until seen working in the app.
        if (doer.touchedUI) {
          if (!deps.behaviorGate) {
            revert(shell, cwd);
            return end(
              "blocked",
              "change touches UI but the headless behavior gate is not available (milestone 2)"
            );
          }
          const b = deps.behaviorGate(binding, config, deps);
          if (b.unverified) {
            // Absence of proof is not disproof. Don't fail the gate — record
            // the gap; if the judge approves, the work ships as a draft PR
            // flagged for human verification instead of being reverted.
            iterUnverified.push(b.unverified);
          } else {
            gates.behavior = b.passed;
          }
          log({
            event: "behavior",
            iteration,
            passed: b.passed,
            ...(b.unverified ? { unverified: b.unverified } : {}),
            shots: b.screenshots.length,
            notes: b.notes
          });
        }

        // 4. CORRECTNESS GATE — the reproduce→fix→same-path test.
        if (doer.testCommand) {
          gates.correctness = shell(doer.testCommand, { cwd }).ok;
        }
      }

      const gatesGreen = Object.values(gates).every(Boolean);

      // 5. JUDGE — only worth a session when the objective gates already pass.
      let judge: JudgeResult = {
        approved: false,
        unmet: [],
        feedback: "gates failed"
      };
      if (gatesGreen) {
        const judgeRes = claude({
          prompt: buildJudgePrompt(binding),
          cwd,
          maxTurns: config.judgeMaxTurns,
          maxBudgetUsd: config.judgeMaxBudgetUsd
        });
        judge = parseJudgeResult(judgeRes.text);
        log({
          event: "judge",
          iteration,
          approved: judge.approved,
          unmet: judge.unmet,
          ...(judge.disputed ? { disputed: judge.disputed } : {})
        });
      }

      // Disputed criteria are product questions, not build targets — surface
      // them (they reach the PR/issue) whether or not this change is kept.
      const disputedQs = (judge.disputed ?? []).map(
        (d) =>
          `Acceptance [${d.index}] "${binding.acceptance[d.index] ?? "?"}": ${d.question}`
      );
      questions.push(...disputedQs);

      // 6. DECIDE + LEDGER. Keep iff every gate is green AND the judge approves.
      const keep = gatesGreen && judge.approved;
      if (dirty) {
        if (keep) commit(shell, cwd, `loop(${binding.id}): ${doer.change}`);
        else revert(shell, cwd);
      }
      if (keep) {
        unverified.push(...iterUnverified);
        questions.push(
          ...(doer.assumptions ?? []).map((a) => `Assumption: ${a}`)
        );
      }
      appendLedger(ledgerPath, {
        iteration,
        change: doer.change,
        gates,
        decision: keep ? "keep" : "revert",
        reason: keep
          ? iterUnverified.length > 0
            ? "gates green; judge approved (behavior proof incomplete)"
            : "all gates green; judge approved"
          : revertReason(gates, judge),
        ...(iterUnverified.length > 0 ? { unverified: iterUnverified } : {}),
        ...(disputedQs.length > 0 ? { questions: disputedQs } : {}),
        ...(doer.assumptions && doer.assumptions.length > 0
          ? { assumptions: doer.assumptions }
          : {}),
        at: now()
      });

      // 7. TERMINATE?
      if (keep && judge.unmet.length === 0) {
        return end(
          "shipped",
          unverified.length > 0
            ? "acceptance met per judge; behavior proof incomplete — needs human verification"
            : "all acceptance criteria met and provable"
        );
      }
      // Progress = a real change was committed. A clean no-op never counts.
      if (keep && dirty) sinceKeep = 0;
      else sinceKeep++;
      if (sinceKeep >= config.plateauAfter) {
        return end("plateau", `no progress across ${sinceKeep} iterations`);
      }
    } catch (err) {
      // Any unexpected failure (e.g. claude returned no JSON at all, git/fs
      // error) is recorded and ends the run cleanly — never an uncaught crash
      // that loses the worktree state and writes no ledger.
      const message = err instanceof Error ? err.message : String(err);
      try {
        revert(shell, cwd);
      } catch {
        /* best-effort */
      }
      appendLedger(ledgerPath, {
        iteration,
        change: "(error)",
        gates: {},
        decision: "revert",
        reason: `loop error: ${message}`,
        at: now()
      });
      return end("error", message);
    }
  }

  return end("plateau", `hit max iterations (${config.maxIterations})`);
}
