import { join } from "node:path";
import { execa } from "execa";

/**
 * Spawn `turbo run dev` filtered to the requested apps. Each app's `dev`
 * script invokes portless, which loads `apps/<id>/portless.json` and runs
 * `dev:app` (react-router dev) behind a stable URL.
 */
export function spawnAppsViaTurbo(opts: {
  root: string;
  apps: string[];
  signal: AbortSignal;
}): Promise<void> {
  const { root, apps, signal } = opts;
  const filters = apps.flatMap((id) => ["--filter", `./apps/${id}`]);
  const child = execa("turbo", ["run", "dev", ...filters], {
    cwd: root,
    stdio: "inherit",
    preferLocal: true,
    reject: false,
    cancelSignal: signal,
    forceKillAfterDelay: 10_000
  });
  return child.then(() => undefined).catch(() => undefined);
}

/** Detached stripe webhook listener (CARBON_EDITION=cloud only). */
export function spawnStripeListener(root: string) {
  execa("npm", ["run", "dev:stripe"], {
    cwd: root,
    detached: true,
    stdio: "ignore"
  }).unref();
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
