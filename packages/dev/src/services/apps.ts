import { join } from "node:path";
import { execa } from "execa";

/**
 * Spawn `turbo run dev` filtered to the requested apps. Each app's `dev`
 * script invokes portless, which loads `apps/<id>/portless.json` and runs
 * `dev:app` (react-router dev) behind a stable URL.
 *
 * Signal handling note: terminal SIGINT is delivered to the whole process
 * group, so turbo also receives it and runs its own graceful shutdown
 * ("Finishing writing to cache..."). We swallow SIGINT/SIGTERM in the
 * parent so Node's default handler doesn't exit code 130 mid-shutdown,
 * which would otherwise cause turbo to print "run failed: command exited"
 * because its children were killed before turbo could clean them up.
 *
 * Once turbo exits (clean or via signal), we resolve undefined; up()
 * then returns and the process exits 0.
 */
export function spawnAppsViaTurbo(opts: {
  root: string;
  apps: string[];
}): Promise<void> {
  const { root, apps } = opts;
  const filters = apps.flatMap((id) => ["--filter", `./apps/${id}`]);
  const child = execa("turbo", ["run", "dev", ...filters], {
    cwd: root,
    stdio: "inherit",
    preferLocal: true,
    reject: false
  });

  const swallow = () => {};
  process.on("SIGINT", swallow);
  process.on("SIGTERM", swallow);

  return child
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      process.off("SIGINT", swallow);
      process.off("SIGTERM", swallow);
    });
}

/** Detached stripe webhook listener (CARBON_EDITION=cloud only). */
export function spawnStripeListener(root: string) {
  execa("npm", ["run", "dev:stripe"], {
    cwd: root,
    detached: true,
    stdio: "ignore"
  }).unref();
}

/**
 * Run `pnpm install` in the worktree root. No-op when the lockfile + store
 * are already in sync — pnpm short-circuits in ~1s. New worktrees (fresh
 * `crbn checkout`) start empty, so this populates `node_modules/` before
 * anything tries to spawn `tsx`/`turbo`/etc. from `node_modules/.bin`.
 *
 * `--prefer-offline` keeps subsequent runs fast even on flaky networks.
 * stdio inherited so the user sees pnpm progress + can answer prompts
 * (e.g. patch-package warnings).
 */
export async function installDeps(root: string) {
  const r = await execa("pnpm", ["install", "--prefer-offline"], {
    cwd: root,
    stdio: "inherit",
    reject: false,
    extendEnv: true
  });
  if (r.exitCode !== 0) {
    throw new Error(`pnpm install failed (exit ${r.exitCode})`);
  }
}

/** Setup-env-files invocation — writes per-app .env / .env.local symlinks. */
export async function syncEnvSymlinks(root: string) {
  const r = await execa("tsx", [join("scripts", "setup-env-files.ts")], {
    cwd: root,
    reject: false,
    preferLocal: true
  });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    throw new Error(`setup-env-files failed (exit ${r.exitCode})`);
  }
}
