import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ExecaChildProcess, execa } from "execa";
import pc from "picocolors";

const APP_COLORS: Record<string, (s: string) => string> = {
  erp: pc.cyan,
  mes: pc.magenta
};

/**
 * Pre-vite chatter we always drop:
 *   `-- Proxy is running`, `-- Using port 4024`, `-- Name "mes" (from ...)`,
 *   `-- Prefix "boo" ...`, the bare app URL banner — emitted by portless
 *   before the inner dev script starts.
 *   `> mes@ dev:app /path` + `> react-router dev --port ...` — pnpm's
 *   "running script" echo.
 *   Empty leading/trailing separators portless prints around the banner.
 * vite's "Local: …" / "ready in …" lines + error output are NOT filtered.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*--\s/, // portless banner lines
  /^\s*>\s/, // pnpm script-echo lines
  /^\s*$/ // blank lines (consecutive blanks are pure noise; vite re-prints separators)
];

function isNoiseLine(line: string): boolean {
  // Strip ANSI before matching — pnpm/portless wrap their banners in colour.
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return NOISE_PATTERNS.some((re) => re.test(plain));
}

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
 * Shutdown: first Ctrl+C sends SIGTERM to every child + a 5s deadline. Second
 * Ctrl+C (or deadline expiry) escalates to SIGKILL and force-exits. Without
 * the active kill, the terminal SIGINT alone often hangs because portless
 * waits on its own react-router child whose vite dev server can take >10s to
 * unwind, leaving `crbn up` stuck on Promise.all.
 */
export function spawnAppsViaTurbo(opts: {
  root: string;
  apps: string[];
}): Promise<void> {
  const { root, apps } = opts;

  let shuttingDown = false;

  const children: ExecaChildProcess[] = apps.map((id) => {
    const color = APP_COLORS[id] ?? ((s: string) => s);
    // detached: true puts the child (portless) into its own process group so
    // we can later signal the whole subtree (portless → react-router → vite)
    // with `process.kill(-pid, ...)`. Without this, killing portless leaves
    // its grandchildren (vite dev server, esbuild) running.
    const child = execa("portless", ["--script", "dev:app", "run", "--force"], {
      cwd: join(root, "apps", id),
      preferLocal: true,
      reject: false,
      stdin: "ignore",
      detached: true
    });

    const prefix = color(pc.bold(`${id.padEnd(3)} | `));
    const pipe = (
      stream: NodeJS.ReadableStream | null,
      sink: NodeJS.WriteStream
    ) => {
      if (!stream) return;
      let buf = "";
      stream.on("data", (chunk) => {
        // Drop late stderr noise once shutdown started (EPIPE traces, vite's
        // ELIFECYCLE 143, esbuild's "service was stopped" — all expected).
        if (shuttingDown) return;
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (isNoiseLine(line)) continue;
          sink.write(`${prefix}${line}\n`);
        }
      });
      stream.on("end", () => {
        if (!shuttingDown && buf.length > 0 && !isNoiseLine(buf)) {
          sink.write(`${prefix}${buf}\n`);
        }
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);

    return child;
  });

  let killTimer: NodeJS.Timeout | undefined;

  const shutdown = (signal: "SIGTERM" | "SIGKILL") => {
    for (const c of children) {
      if (c.exitCode !== null || !c.pid) continue;
      try {
        // Negative pid signals the whole process group (we spawned each child
        // detached). Reaches portless + its react-router/vite descendants.
        process.kill(-c.pid, signal);
      } catch {
        try {
          c.kill(signal);
        } catch {}
      }
    }
  };

  const onSignal = () => {
    if (shuttingDown) {
      // Second Ctrl+C — force kill immediately.
      if (killTimer) clearTimeout(killTimer);
      shutdown("SIGKILL");
      return;
    }
    shuttingDown = true;
    process.stderr.write("\nstopping apps…\n");
    shutdown("SIGTERM");
    // Belt-and-braces: if SIGTERM is ignored we escalate after 3s. Most app
    // children are gone within ~500ms; this is a safety net, not the path.
    killTimer = setTimeout(() => shutdown("SIGKILL"), 3_000);
  };

  // SIGINT (Ctrl+C), SIGTERM (kill / IDE stop), SIGHUP (terminal closed),
  // SIGBREAK (Windows Ctrl+Break — no-op on POSIX but harmless to listen).
  const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const;
  for (const s of SIGNALS) process.on(s, onSignal);

  return Promise.all(children)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      if (killTimer) clearTimeout(killTimer);
      for (const s of SIGNALS) process.off(s, onSignal);
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
