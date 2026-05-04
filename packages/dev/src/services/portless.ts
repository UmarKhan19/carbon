import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { execa } from "execa";
import { addDependency } from "nypm";
import pc from "picocolors";
import { ALIAS_SERVICES, PORTLESS_MIN_VERSION, TLD } from "../constants.js";

/**
 * Make sure portless is on the user's PATH at the required version.
 * Per upstream guidance portless lives global, not as a project dep.
 */
export async function ensurePortlessInstalled() {
  const installed = await detectPortlessVersion();
  if (installed && cmpSemver(installed, PORTLESS_MIN_VERSION) >= 0) return;

  if (!installed) {
    log.warn(
      `portless is not installed globally. Required for app routing (${PORTLESS_MIN_VERSION}+).`
    );
  } else {
    log.warn(
      `portless v${installed} is too old. Need ${PORTLESS_MIN_VERSION}+ for monorepo + package.json config.`
    );
  }

  const ok = await confirm({
    message: "Install portless@latest globally now?",
    initialValue: true
  });
  if (isCancel(ok) || !ok) {
    throw new Error(
      `Aborted. Install manually: ${pc.cyan("npm install -g portless@latest")} (or bun/pnpm equivalent).`
    );
  }

  const s = spinner();
  s.start("installing portless@latest globally");
  try {
    await addDependency("portless", { global: true, silent: true });
  } catch (err) {
    s.stop("✗ install failed");
    throw new Error(
      `portless install failed. Run manually: ${pc.cyan("npm install -g portless@latest")}.\n${err instanceof Error ? err.message : String(err)}`
    );
  }
  const after = await detectPortlessVersion();
  s.stop(`portless v${after ?? "?"} installed`);
}

/** Start the portless proxy daemon (idempotent). */
export function startProxyDaemon(root: string) {
  execa("portless", ["proxy", "start"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    preferLocal: true
  }).unref();
}

/** Block until the portless proxy PID file shows a live process. */
export async function waitForProxyReady(timeoutMs = 30_000) {
  const tldFile = `${homedir()}/.portless/proxy.tld`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(tldFile) && existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      try {
        process.kill(pid, 0);
        await sleep(500);
        return;
      } catch {}
    }
    await sleep(500);
  }
}

/** Register compose-service host:port aliases with the portless proxy. */
export async function registerAliases(
  root: string,
  branchSegment: string,
  ports: Record<string, number>
) {
  const aliases = aliasMap(branchSegment, ports);
  await Promise.all(
    aliases.map((a) =>
      execa("portless", ["alias", a.name, String(a.port), "--force"], {
        cwd: root,
        reject: false,
        stdio: "ignore",
        preferLocal: true
      })
    )
  );
  return aliases.length;
}

/** Remove this worktree's compose-service aliases (called by `dev down`). */
export async function unregisterAliases(root: string, branchSegment: string) {
  await Promise.all(
    ALIAS_SERVICES.map((s) => `${s}.${branchSegment}`).map((name) =>
      execa("portless", ["alias", "--remove", name], {
        cwd: root,
        reject: false,
        stdio: "ignore",
        preferLocal: true
      })
    )
  );
}

/**
 * Drop alias entries from `~/.portless/routes.json` that match our branch
 * segment. Stale routes (different TLD, dead PID) accumulate across runs.
 */
export function pruneStaleRoutes(branchSegment: string) {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return 0;
  let routes: { hostname: string; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
  const ourHosts = ALIAS_SERVICES.flatMap((s) => [
    `${s}.${branchSegment}.dev`,
    `${s}.${branchSegment}.localhost`
  ]);
  const before = routes.length;
  const filtered = routes.filter(
    (r) => !(r.pid === 0 && ourHosts.includes(r.hostname))
  );
  if (filtered.length !== before) {
    writeFileSync(path, JSON.stringify(filtered, null, 2));
    return before - filtered.length;
  }
  return 0;
}

/**
 * Write per-app `portless.json` so portless uses our `<app>.<branch>` naming
 * regardless of the current worktree's auto-detection.
 */
export function writeAppPortlessConfig(
  appDir: string,
  cfg: { name: string; script: string }
) {
  writeFileSync(
    join(appDir, "portless.json"),
    JSON.stringify(cfg, null, 2) + "\n"
  );
}

export function aliasMap(
  branchSegment: string,
  ports: Record<string, number>
): { name: string; port: number }[] {
  return [
    { name: `api.${branchSegment}`, port: ports.PORT_API },
    { name: `studio.${branchSegment}`, port: ports.PORT_STUDIO },
    { name: `mail.${branchSegment}`, port: ports.PORT_INBUCKET },
    { name: `inngest.${branchSegment}`, port: ports.PORT_INNGEST }
  ];
}

export function host(sub: string, branchSegment: string) {
  return `${sub}.${branchSegment}.${TLD}`;
}

async function detectPortlessVersion(): Promise<string | null> {
  const r = await execa("portless", ["--version"], { reject: false });
  if (r.exitCode !== 0) return null;
  const m = r.stdout.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : null;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
