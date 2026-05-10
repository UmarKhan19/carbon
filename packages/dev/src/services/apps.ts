import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ExecaChildProcess, execa } from "execa";
import pc from "picocolors";

const APP_COLORS: Record<string, (s: string) => string> = {
  erp: pc.cyan,
  mes: pc.magenta
};

/**
 * Spawn each app's portless wrapper directly, bypassing the per-app `dev`
 * script. Branches lag behind the canonical script
 * (`portless --script dev:app run --force`) — older revisions just have
 * `dev: portless`, which sends portless into default mode where its child
 * resolves to the same `dev` script and respawns portless infinitely. The
 * recursion races to register `<prefix>.<app>.dev` and trips
 * `RouteConflictError` on the loser.
 *
 * Calling portless ourselves with the canonical args keeps `crbn up`
 * deterministic across branches. We also lose turbo's prefixed log output,
 * so we prefix child output here and stream stderr through.
 *
 * Signal handling: terminal SIGINT goes to the whole process group, so each
 * spawned portless gets it directly and runs its own cleanup. We swallow
 * SIGINT/SIGTERM in the parent so Node's default handler doesn't exit 130
 * mid-shutdown (children would die before route cleanup).
 */
export function spawnAppsViaTurbo(opts: {
  root: string;
  apps: string[];
}): Promise<void> {
  const { root, apps } = opts;

  const children: ExecaChildProcess[] = apps.map((id) => {
    const color = APP_COLORS[id] ?? ((s: string) => s);
    const child = execa("portless", ["--script", "dev:app", "run", "--force"], {
      cwd: join(root, "apps", id),
      preferLocal: true,
      reject: false,
      stdin: "ignore"
    });

    const prefix = color(pc.bold(`${id.padEnd(3)} | `));
    const pipe = (
      stream: NodeJS.ReadableStream | null,
      sink: NodeJS.WriteStream
    ) => {
      if (!stream) return;
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) sink.write(`${prefix}${line}\n`);
      });
      stream.on("end", () => {
        if (buf.length > 0) sink.write(`${prefix}${buf}\n`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);

    return child;
  });

  const swallow = () => {};
  process.on("SIGINT", swallow);
  process.on("SIGTERM", swallow);

  return Promise.all(children)
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
 * Run `pnpm install` in the worktree root. Skipped when
 * `node_modules/.modules.yaml` is at least as new as `pnpm-lock.yaml` — that's
 * the marker pnpm itself stamps after a successful install, so a newer
 * marker means deps already match the lockfile. Saves ~1s per `crbn up` and,
 * more importantly, the noisy progress output.
 *
 * Returns true if install actually ran, false if skipped.
 *
 * `--prefer-offline` keeps subsequent runs fast even on flaky networks.
 * stdio inherited so the user sees pnpm progress + can answer prompts
 * (e.g. patch-package warnings).
 */
export async function installDeps(root: string): Promise<boolean> {
  if (depsInSync(root)) return false;

  const r = await execa("pnpm", ["install", "--prefer-offline"], {
    cwd: root,
    stdio: "inherit",
    reject: false,
    extendEnv: true
  });
  if (r.exitCode !== 0) {
    throw new Error(`pnpm install failed (exit ${r.exitCode})`);
  }
  return true;
}

function depsInSync(root: string): boolean {
  const lockfile = join(root, "pnpm-lock.yaml");
  const marker = join(root, "node_modules", ".modules.yaml");
  if (!existsSync(lockfile) || !existsSync(marker)) return false;
  try {
    return statSync(marker).mtimeMs >= statSync(lockfile).mtimeMs;
  } catch {
    return false;
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
