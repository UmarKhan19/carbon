import { existsSync } from "node:fs";
import {
  cancel,
  confirm,
  isCancel,
  log,
  multiselect,
  note,
  select,
  text
} from "@clack/prompts";
import { join } from "pathe";
import pc from "picocolors";
import { APP_CHOICES, type AppId } from "./constants.js";
import { branchExists, deleteBranch, listWorktrees } from "./git.js";

// git-check-ref-format(1) rules.
const INVALID_BRANCH_RE =
  /(^[/-])|([/-]$)|(\.\.)|(@\{)|([\s~^:?*[\\])|(\/{2,})/;

export async function pickApps(): Promise<AppId[]> {
  const fromEnv = process.env.CARBON_DEV_APPS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is AppId => APP_CHOICES.some((c) => c.value === s));
  }
  if (!process.stdin.isTTY) return APP_CHOICES.map((c) => c.value);

  note(
    "When no apps are selected it will only run (postgres, kong, supabase, inngest, mail) without spawning ERP/MES dev servers.",
    "Tip"
  );
  const picked = await multiselect({
    initialValues: APP_CHOICES.map((c) => c.value),
    message: "Which apps to run?",
    options: APP_CHOICES.map((c) => ({
      hint: c.hint,
      label: c.label,
      value: c.value
    })),
    required: false
  });
  if (isCancel(picked)) abort();
  return picked as AppId[];
}

export async function promptBranch(): Promise<string> {
  while (true) {
    const value = await text({
      message: "Branch name",
      placeholder: "feature/foo",
      validate(v) {
        if (!v || !v.trim()) return "Branch is required";
        const t = v.trim();
        if (INVALID_BRANCH_RE.test(t))
          return "Invalid git branch name (no spaces, control chars, ~^:?*[\\, no leading/trailing - or /, no '..' or '@{')";
        if (t.length > 100) return "Branch name too long";
      }
    });
    if (isCancel(value)) abort();
    const trimmed = (value as string).trim();
    if (await branchExists(trimmed)) {
      const worktrees = await listWorktrees();
      const onWorktree = worktrees.find((w) => w.branch === trimmed);
      if (onWorktree) {
        log.error(
          `Branch '${trimmed}' already has a worktree at ${pc.dim(onWorktree.path)}\n` +
            `  Jump in with:  ${pc.cyan(`crbn go ${trimmed}`)}`
        );
        continue;
      }
      // Branch without worktree → offer in-flow nuke + recreate.
      log.warn(
        `Branch '${trimmed}' exists locally but has no worktree.\n` +
          `  Materialize the existing branch with:  ${pc.cyan(`crbn checkout ${trimmed}`)}`
      );
      const recreate = await confirm({
        initialValue: false,
        message: `Delete '${trimmed}' (force) and create fresh branch?`
      });
      if (isCancel(recreate)) abort();
      if (!recreate) continue;
      try {
        await deleteBranch(trimmed);
      } catch (err) {
        log.error(`Failed to delete branch: ${(err as Error).message}`);
        continue;
      }
      log.success(`Deleted branch '${trimmed}'`);
    }
    return trimmed;
  }
}

export async function promptDirName(
  parentDir: string,
  initial: string
): Promise<string> {
  while (true) {
    const value = await text({
      initialValue: initial,
      message: `Worktree directory (relative to ${pc.dim(parentDir)})`,
      validate(v) {
        if (!v || !v.trim()) return "Directory name required";
        if (/[\s/]/.test(v.trim()))
          return "No spaces or slashes — must be a single dirname";
      }
    });
    if (isCancel(value)) abort();
    const trimmed = (value as string).trim();
    if (existsSync(join(parentDir, trimmed))) {
      log.error(`Path '${trimmed}' already exists in ${parentDir}`);
      continue;
    }
    return trimmed;
  }
}

export async function promptBaseRef(
  currentBranch: string | null
): Promise<string> {
  const opts: { value: string; label: string }[] = [
    { label: "main", value: "main" }
  ];
  if (currentBranch && currentBranch !== "main") {
    opts.push({ label: currentBranch, value: currentBranch });
  }
  opts.push({ label: "origin/main", value: "origin/main" });

  const baseRef = await select({
    initialValue: "main",
    message: "Base ref",
    options: opts
  });
  if (isCancel(baseRef)) abort();
  return baseRef as string;
}

export async function promptCopyEnv(): Promise<boolean> {
  const ok = await confirm({
    initialValue: true,
    message: "Copy .env from current worktree?"
  });
  if (isCancel(ok)) abort();
  return ok as boolean;
}

export async function confirmReset(projectName: string): Promise<boolean> {
  if (process.env.CARBON_DEV_YES === "1") return true;
  const ok = await confirm({
    initialValue: false,
    message: `Destroy all volumes for ${pc.bold(projectName)}? (postgres, storage, inngest data will be wiped, redis db flushed)`
  });
  if (isCancel(ok)) return false;
  return ok as boolean;
}

export async function confirmRemove(opts: {
  branchOrPath: string;
  hasStack: boolean;
}): Promise<boolean> {
  const ok = await confirm({
    initialValue: false,
    message: `Permanently remove ${opts.branchOrPath} and ${opts.hasStack ? "wipe its docker volumes" : "the worktree"}?`
  });
  if (isCancel(ok)) return false;
  return ok as boolean;
}

function abort(): never {
  cancel("aborted");
  process.exit(0);
}
