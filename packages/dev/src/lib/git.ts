import { execa } from "execa";

export type Worktree = {
  path: string;
  branch: string | null; // null = detached
  head: string;
  bare: boolean;
  current: boolean;
};

export async function gitRoot(): Promise<string> {
  const r = await execa("git", ["rev-parse", "--show-toplevel"]);
  return r.stdout.trim();
}

export async function isLinkedWorktree(): Promise<boolean> {
  // Linked worktree: --absolute-git-dir points at .git/worktrees/<name>;
  // --git-common-dir points at the shared .git of the main checkout.
  const [a, b] = await Promise.all([
    execa("git", ["rev-parse", "--absolute-git-dir"], { reject: false }),
    execa("git", ["rev-parse", "--git-common-dir"], { reject: false }),
  ]);
  if (a.exitCode !== 0 || b.exitCode !== 0) return false;
  return a.stdout.trim() !== b.stdout.trim();
}

export async function currentBranch(cwd = process.cwd()): Promise<string> {
  try {
    const r = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
    });
    const out = r.stdout.trim();
    return out === "HEAD" ? "" : out;
  } catch {
    return "";
  }
}

export async function listWorktrees(): Promise<Worktree[]> {
  const r = await execa("git", ["worktree", "list", "--porcelain"]);
  const cwd = process.cwd();
  const blocks = r.stdout.trim().split("\n\n");
  return blocks.map((block) => {
    const lines = block.split("\n");
    const get = (key: string) =>
      lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? "";
    const path = get("worktree");
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const branch = branchLine
      ? branchLine.slice("branch refs/heads/".length)
      : null;
    return {
      path,
      branch,
      head: get("HEAD"),
      bare: lines.includes("bare"),
      current: path === cwd,
    };
  });
}

export async function addWorktree(opts: {
  path: string;
  branch: string;
  baseRef: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await execa(
    "git",
    ["worktree", "add", "-b", opts.branch, opts.path, opts.baseRef],
    { reject: false }
  );
  if (r.exitCode !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || "").trim() };
  }
  return { ok: true };
}

export async function removeWorktree(
  path: string,
  force = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  const r = await execa("git", args, { reject: false });
  if (r.exitCode !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || "").trim() };
  }
  return { ok: true };
}

export async function isDirty(path: string): Promise<boolean> {
  const r = await execa("git", ["status", "--porcelain"], {
    cwd: path,
    reject: false,
  });
  return r.exitCode === 0 && (r.stdout || "").trim().length > 0;
}

export async function branchExists(branch: string): Promise<boolean> {
  const r = await execa(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { reject: false }
  );
  return r.exitCode === 0;
}
