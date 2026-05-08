import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

const DEFAULT_INCLUDES = [".env"];

/**
 * Sync files from the main checkout into the current worktree.
 *
 * Source: the worktree that owns `.git/` directly (i.e. `--git-common-dir`'s
 * parent). For linked worktrees this is the original checkout. Reading
 * `package.json#crbn.copy` from the main checkout — not cwd — keeps the
 * include list version-controlled and stable across worktrees.
 */
export async function copy() {
  intro("Carbon · copy");

  const cwd = process.cwd();
  const mainRoot = await mainCheckoutRoot();
  if (mainRoot === cwd) {
    log.warn("already in main checkout — nothing to copy");
    outro("");
    return;
  }

  const includes = readIncludes(mainRoot);
  let copied = 0;
  for (const rel of includes) {
    const src = join(mainRoot, rel);
    const dest = join(cwd, rel);
    if (!existsSync(src)) {
      log.warn(`${pc.dim(rel)} missing in main checkout — skipped`);
      continue;
    }
    copyFileSync(src, dest);
    log.info(`${pc.green("✓")} ${rel}`);
    copied++;
  }

  outro(
    `${copied} file${copied === 1 ? "" : "s"} copied from ${pc.dim(mainRoot)}`
  );
}

function readIncludes(mainRoot: string): string[] {
  const pkgPath = join(mainRoot, "package.json");
  if (!existsSync(pkgPath)) return DEFAULT_INCLUDES;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      crbn?: { copy?: unknown };
    };
    const list = pkg.crbn?.copy;
    if (Array.isArray(list) && list.every((s) => typeof s === "string")) {
      return list as string[];
    }
  } catch {}
  return DEFAULT_INCLUDES;
}

async function mainCheckoutRoot(): Promise<string> {
  const r = await execa("git", ["rev-parse", "--git-common-dir"], {
    reject: false
  });
  if (r.exitCode !== 0) {
    throw new Error("not inside a git repository");
  }
  // --git-common-dir points at <main>/.git for linked worktrees, or `.git`
  // (relative) for the main worktree itself. Resolve relative-to-cwd, then
  // strip the trailing `.git` segment.
  const gitDir = r.stdout.trim();
  const abs = gitDir.startsWith("/") ? gitDir : join(process.cwd(), gitDir);
  return dirname(abs);
}
