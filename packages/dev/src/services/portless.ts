import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";
import {
  ALIAS_SERVICES,
  type AppId,
  PORTLESS_MIN_VERSION,
  TLD
} from "../constants.js";
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
 * The TLD portless serves. Must match render-env.ts hostnames
 * (`<sub>.<branch>.dev`) and the stable OAuth alias (`api.carbon.dev`).
 */
const PORTLESS_TLD = "dev";

type PrivilegeIssue =
  | { kind: "wrong_port"; port: number }
  | { kind: "not_running" };

function detectPrivilegeIssues(): PrivilegeIssue[] {
  const issues: PrivilegeIssue[] = [];
  const portFile = `${homedir()}/.portless/proxy.port`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;

  if (!existsSync(portFile) || !existsSync(pidFile)) {
    issues.push({ kind: "not_running" });
    return issues;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!isProcessAlive(pid)) {
    issues.push({ kind: "not_running" });
    return issues;
  }
  const port = Number(readFileSync(portFile, "utf8").trim());
  if (port && port !== 80 && port !== 443) {
    issues.push({ kind: "wrong_port", port });
  }
  return issues;
}

/**
 * `kill(pid, 0)` returns:
 *   - 0      → process exists, signal allowed (same uid).
 *   - EPERM  → process exists, but we lack permission to signal it (different
 *              uid, e.g. root-owned portless proxy when we're a normal user).
 *   - ESRCH  → no such process.
 * Treat EPERM as "alive" — a root-owned daemon is still serving.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function describeIssues(issues: PrivilegeIssue[]): string {
  return issues
    .map((i) =>
      i.kind === "not_running"
        ? "portless proxy not running"
        : `proxy on :${i.port} (not :443; URLs would need port suffix)`
    )
    .join("\n  • ");
}

/**
 * Halt-and-prompt before booting the stack. portless needs sudo to bind :443
 * (the privileged port) and to write /etc/hosts entries (via `portless hosts
 * sync`). If the proxy isn't running on a privileged port we ask the user
 * whether to run the sudo commands now. Sudo's password prompt streams to
 * the user's terminal directly via `stdio: "inherit"`.
 *
 * Note: portless doesn't use `/etc/resolver/<tld>` — `.dev` is a public TLD
 * (Google-owned, HSTS-preloaded), so DNS routing happens via `/etc/hosts`
 * entries that `portless hosts sync` writes. We trigger that sync here and
 * also after every alias registration (see syncHostsFile).
 */
export async function ensureProxyPrivileges() {
  const issues = detectPrivilegeIssues();
  if (issues.length === 0) return;

  log.warn(
    [
      "portless needs a privileged proxy to serve `*.dev` cleanly:",
      "",
      `  • ${describeIssues(issues)}`,
      "",
      "Without :443 + /etc/hosts entries, browsers hit the public `.dev` TLD",
      "(NXDOMAIN) or you'd have to type `:<port>` after every URL."
    ].join("\n")
  );

  const proceed = await confirm({
    message:
      "Set it up now? Will run sudo to bind :443, install the local CA, and write /etc/hosts entries.",
    initialValue: true
  });
  if (isCancel(proceed) || !proceed) {
    throw new Error(
      "Aborted. Run manually: `sudo portless proxy stop && sudo portless proxy start --tld dev && sudo portless trust`. Then re-run `crbn up`."
    );
  }

  log.info("running sudo commands — you'll be prompted for your password");

  // sudo resets HOME to root's HOME by default. portless writes its daemon
  // state (pid, port, certs) under $HOME/.portless, so we must preserve the
  // invoking user's HOME — otherwise state lands in /var/root/.portless and
  // our subsequent detection ("not running") fires even though it started.
  const sudoEnvArg = `HOME=${homedir()}`;

  await execa("sudo", [sudoEnvArg, "portless", "proxy", "stop"], {
    stdio: "inherit",
    reject: false
  });

  const start = await execa(
    "sudo",
    [sudoEnvArg, "portless", "proxy", "start", "--tld", PORTLESS_TLD],
    { stdio: "inherit", reject: false }
  );
  if (start.exitCode !== 0) {
    throw new Error(
      `sudo portless proxy start failed (exit ${start.exitCode})`
    );
  }

  const trust = await execa("sudo", [sudoEnvArg, "portless", "trust"], {
    stdio: "inherit",
    reject: false
  });
  if (trust.exitCode !== 0) {
    log.warn(
      `sudo portless trust failed (exit ${trust.exitCode}); browsers may show cert warnings until you run it manually.`
    );
  }

  const remaining = detectPrivilegeIssues();
  if (remaining.length > 0) {
    throw new Error(
      `portless setup still incomplete:\n  • ${describeIssues(remaining)}`
    );
  }

  log.success("portless proxy on :443");
}

/**
 * Push currently-registered portless routes into /etc/hosts so browsers can
 * resolve them. Needs sudo (writes /etc/hosts). Idempotent — portless skips
 * entries already present.
 *
 * Called after `registerAliases` so newly-added routes (e.g. our per-branch
 * aliases + the stable `api.carbon` OAuth alias) are reachable.
 */
export async function syncHostsFile() {
  const r = await execa(
    "sudo",
    [`HOME=${homedir()}`, "portless", "hosts", "sync"],
    { stdio: "inherit", reject: false }
  );
  if (r.exitCode !== 0) {
    throw new Error(
      `sudo portless hosts sync failed (exit ${r.exitCode}). Run it manually to fix DNS.`
    );
  }
}

/**
 * Returns true when every hostname in `~/.portless/routes.json` is already
 * present in /etc/hosts (within portless's `# portless-start`/`# portless-end`
 * block). Lets `crbn up` skip the `sudo portless hosts sync` step — and the
 * password prompt — when nothing changed since the last run.
 */
export function hostsFileInSync(): boolean {
  const routesPath = `${homedir()}/.portless/routes.json`;
  if (!existsSync(routesPath)) return true; // nothing to sync

  let hosts: { hostname: string }[];
  try {
    hosts = JSON.parse(readFileSync(routesPath, "utf8"));
  } catch {
    return false;
  }
  const desired = new Set(hosts.map((h) => h.hostname));
  if (desired.size === 0) return true;

  let etcHosts: string;
  try {
    etcHosts = readFileSync("/etc/hosts", "utf8");
  } catch {
    return false;
  }
  // Only consider hostnames inside the portless-managed block — anything
  // outside is user-controlled and shouldn't influence sync skip.
  const startIdx = etcHosts.indexOf("# portless-start");
  const endIdx = etcHosts.indexOf("# portless-end");
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return false;
  const block = etcHosts.slice(startIdx, endIdx);
  const present = new Set<string>();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*\d+\.\d+\.\d+\.\d+\s+(\S+)/);
    if (m && m[1]) present.add(m[1]);
  }
  for (const h of desired) {
    if (!present.has(h)) return false;
  }
  return true;
}

/** Block until the portless proxy PID file shows a live process. */
export async function waitForProxyReady(timeoutMs = 30_000) {
  const tldFile = `${homedir()}/.portless/proxy.tld`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(tldFile) && existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (isProcessAlive(pid)) {
        await sleep(500);
        return;
      }
    }
    await sleep(500);
  }
}

/** Register compose-service host:port aliases with the portless proxy. */
export async function registerAliases(
  root: string,
  branchPrefix: string | null,
  ports: PortMap
) {
  const aliases = aliasMap(branchPrefix, ports);
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
export async function unregisterAliases(
  root: string,
  branchPrefix: string | null
) {
  await Promise.all(
    ALIAS_SERVICES.map((s) => withPrefix(s, branchPrefix)).map((name) =>
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
 * Pre-empt `<prefix>.<app>.{dev,localhost}` hostnames before turbo spawns the
 * app dev-servers. Orphan portless processes from a prior `crbn up` (Ctrl+C
 * race, crashed turbo) keep the route registered with a still-alive PID, and
 * the next `portless run` aborts with `RouteConflictError` unless the app's
 * dev script passes `--force`. Older feature branches don't have that flag,
 * so we have to do the equivalent out-of-band here.
 *
 * For each matching route with a non-zero PID, sends SIGTERM, polls briefly,
 * escalates to SIGKILL once. Then drops every matching entry from the routes
 * file unconditionally — the freshly-spawned app will reclaim the slot via
 * its own `addRoute` call. Returns the number of PIDs we signalled.
 */
export async function claimAppHosts(
  branchPrefix: string | null,
  appIds: readonly AppId[]
): Promise<number> {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return 0;

  let routes: { hostname: string; port: number; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }

  const ourHosts = new Set(
    appIds.flatMap((id) => {
      const name = withPrefix(id, branchPrefix);
      return [`${name}.dev`, `${name}.localhost`];
    })
  );

  const pidsToKill = new Set<number>();
  for (const r of routes) {
    if (ourHosts.has(r.hostname) && r.pid > 0 && isProcessAlive(r.pid)) {
      pidsToKill.add(r.pid);
    }
  }

  for (const pid of pidsToKill) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  // Poll up to ~400ms for graceful exit; escalate to SIGKILL on stragglers.
  const deadline = Date.now() + 400;
  while (Date.now() < deadline) {
    let allGone = true;
    for (const pid of pidsToKill) {
      if (isProcessAlive(pid)) {
        allGone = false;
        break;
      }
    }
    if (allGone) break;
    await sleep(50);
  }
  for (const pid of pidsToKill) {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }

  const filtered = routes.filter((r) => !ourHosts.has(r.hostname));
  if (filtered.length !== routes.length) {
    writeFileSync(path, JSON.stringify(filtered, null, 2));
  }

  return pidsToKill.size;
}

/**
 * Drop stale alias entries from `~/.portless/routes.json` that match our
 * worktree's compose-service hostname pattern. Stale routes (different TLD,
 * dead PID) accumulate across runs.
 */
export function pruneStaleRoutes(branchPrefix: string | null) {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return 0;
  let routes: { hostname: string; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
  const ourHosts = ALIAS_SERVICES.flatMap((s) => {
    const name = withPrefix(s, branchPrefix);
    return [`${name}.dev`, `${name}.localhost`];
  });
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
 * Stable, branch-independent OAuth callback hostname. Lets a single redirect
 * URI live in the Google/Azure OAuth client config across all worktrees —
 * whichever worktree was last `up` owns this alias and services callbacks.
 *
 * Keep in sync with SUPABASE_AUTH_EXTERNAL_*_REDIRECT_URI in render-env.ts.
 */
export const STABLE_OAUTH_ALIAS = "api.carbon";

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "develop", "dev"]);

/**
 * Mirrors portless's worktree-prefix derivation
 * (packages/portless/dist/cli.js:branchToPrefix). Returns null when:
 *   - branch is missing/HEAD
 *   - branch is a default trunk-like name (main/master/etc.)
 *   - sanitized last-segment is empty
 *
 * Otherwise returns the last `/`-separated segment of the branch, sanitized
 * for hostname use. e.g. `feat/boo` -> `boo`, `sid/local-dev` -> `local-dev`.
 *
 * Note: portless ALSO checks the working directory is a linked worktree
 * before applying the prefix. Callers should combine this with that check
 * (see isLinkedWorktree() in lib/git.ts).
 */
export function branchToPrefix(
  branch: string | null | undefined
): string | null {
  if (!branch || branch === "HEAD" || DEFAULT_BRANCHES.has(branch)) return null;
  const last = branch.split("/").pop() ?? "";
  const sanitized = last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return sanitized || null;
}

/** Build hostname matching portless's `<prefix>.<name>.<tld>` shape. */
function withPrefix(name: string, prefix: string | null): string {
  return prefix ? `${prefix}.${name}` : name;
}

/**
 * Per-worktree compose-service aliases. Hostnames mirror what portless
 * registers for app dev-servers in the same worktree, so URLs are
 * consistent: linked worktrees get `<prefix>.<service>.<tld>`, the main
 * checkout gets bare `<service>.<tld>`.
 */
export function aliasMap(
  branchPrefix: string | null,
  ports: PortMap
): { name: string; port: number }[] {
  return [
    { name: withPrefix("api", branchPrefix), port: ports.PORT_API },
    { name: withPrefix("studio", branchPrefix), port: ports.PORT_STUDIO },
    { name: withPrefix("mail", branchPrefix), port: ports.PORT_INBUCKET },
    { name: withPrefix("inngest", branchPrefix), port: ports.PORT_INNGEST },
    // Stable redirect target for OAuth providers. Last `crbn up` wins.
    { name: STABLE_OAUTH_ALIAS, port: ports.PORT_API }
  ];
}

export function host(sub: string, branchPrefix: string | null) {
  return `${withPrefix(sub, branchPrefix)}.${TLD}`;
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
