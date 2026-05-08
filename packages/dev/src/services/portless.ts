import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";
import { ALIAS_SERVICES, PORTLESS_MIN_VERSION, TLD } from "../constants.js";
import type { PortMap } from "../lib/ports.js";

/**
 * Env passed to every spawned `portless`. Strips `npm_*` / `PNPM_*` so
 * portless doesn't self-detect pnpm-managed invocation and refuse with
 * "should not be run via npx or pnpm dlx" — we delegate to portless from
 * inside `pnpm exec tsx`, which sets vars like `npm_command=exec` and
 * `PNPM_SCRIPT_SRC_DIR` even though portless itself was installed globally.
 *
 * Use with `extendEnv: false` on the execa call — otherwise execa merges
 * `env` on top of process.env and the original vars come back.
 */
function portlessEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PNPM_") || k.startsWith("npm_")) continue;
    out[k] = v;
  }
  return out;
}

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
  s.start("installing portless@latest globally (pnpm add -g)");
  const r = await execa("pnpm", ["add", "-g", "portless@latest"], {
    reject: false
  });
  if (r.exitCode !== 0) {
    s.stop("✗ install failed");
    const stderr = r.stderr ?? "";
    const stdout = r.stdout ?? "";
    const combined = `${stderr}\n${stdout}`;

    // Most common failure on a fresh dev box: pnpm has no global bin dir
    // configured. Surface the exact pnpm-recommended fix instead of a stack.
    if (/ERR_PNPM_NO_GLOBAL_BIN_DIR/.test(combined)) {
      log.error("pnpm has no global bin directory configured.");
      log.message(
        [
          "To fix this, run pnpm's one-time setup (creates ~/.local/share/pnpm",
          "and writes PNPM_HOME to your shell rc), then re-run `crbn up`:",
          "",
          `    ${pc.cyan("pnpm setup")}`,
          `    ${pc.cyan("source ~/.zshrc   # or open a new shell")}`,
          `    ${pc.cyan("crbn up")}`,
          "",
          "Alternative — install portless via npm instead:",
          "",
          `    ${pc.cyan("npm install -g portless@latest")}`
        ].join("\n")
      );
      throw new Error("portless install aborted: pnpm global bin dir missing");
    }

    process.stderr.write(stderr);
    throw new Error(
      `pnpm add -g portless failed (exit ${r.exitCode}). Manual fallback: ${pc.cyan("npm install -g portless@latest")}`
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
    preferLocal: true,
    extendEnv: false,
    env: portlessEnv()
  }).unref();
}

/**
 * Detect a privileged-setup mismatch: proxy is running but didn't get sudo,
 * so it fell back to `--port <high> --skip-trust` and didn't write
 * `/etc/resolver/dev`. Browsers see NXDOMAIN for `*.dev`. Returns null if
 * everything's fine, or a string explaining what's missing + how to fix.
 */
export function diagnoseProxyPrivileges(): string | null {
  const portFile = `${homedir()}/.portless/proxy.port`;
  const tldFile = `${homedir()}/.portless/proxy.tld`;
  if (!existsSync(portFile) || !existsSync(tldFile)) return null;

  const port = Number(readFileSync(portFile, "utf8").trim());
  const tld = readFileSync(tldFile, "utf8").trim();
  if (!port || !tld) return null;

  const isPrivilegedPort = port === 80 || port === 443;
  const resolverFile = `/etc/resolver/${tld}`;
  const hasResolver = existsSync(resolverFile);

  if (isPrivilegedPort && hasResolver) return null;

  const issues: string[] = [];
  if (!isPrivilegedPort) issues.push(`proxy on :${port} (not :443)`);
  if (!hasResolver) issues.push(`no ${resolverFile}`);

  return [
    `portless proxy is up but missing sudo setup (${issues.join(", ")}).`,
    "URLs like https://erp.<branch>.dev won't resolve until you run:",
    "",
    "    portless proxy stop",
    `    sudo portless proxy start --tld ${tld}`,
    "    sudo portless trust",
    "",
    "Then re-run `crbn up`."
  ].join("\n");
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
  ports: PortMap
) {
  const aliases = aliasMap(branchSegment, ports);
  await Promise.all(
    aliases.map((a) =>
      execa("portless", ["alias", a.name, String(a.port), "--force"], {
        cwd: root,
        reject: false,
        stdio: "ignore",
        preferLocal: true,
        extendEnv: false,
        env: portlessEnv()
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
        preferLocal: true,
        extendEnv: false,
        env: portlessEnv()
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

/**
 * Stable, branch-independent OAuth callback hostname. Lets a single redirect
 * URI live in the Google/Azure OAuth client config across all worktrees —
 * whichever worktree was last `up` owns this alias and services callbacks.
 *
 * Keep in sync with SUPABASE_AUTH_EXTERNAL_*_REDIRECT_URI in render-env.ts.
 */
export const STABLE_OAUTH_ALIAS = "api.carbon";

export function aliasMap(
  branchSegment: string,
  ports: PortMap
): { name: string; port: number }[] {
  return [
    { name: `api.${branchSegment}`, port: ports.PORT_API },
    { name: `studio.${branchSegment}`, port: ports.PORT_STUDIO },
    { name: `mail.${branchSegment}`, port: ports.PORT_INBUCKET },
    { name: `inngest.${branchSegment}`, port: ports.PORT_INNGEST },
    // Stable redirect target for OAuth providers. Last `crbn up` wins.
    { name: STABLE_OAUTH_ALIAS, port: ports.PORT_API }
  ];
}

export function host(sub: string, branchSegment: string) {
  return `${sub}.${branchSegment}.${TLD}`;
}

async function detectPortlessVersion(): Promise<string | null> {
  const r = await execa("portless", ["--version"], {
    reject: false,
    extendEnv: false,
    env: portlessEnv()
  });
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
