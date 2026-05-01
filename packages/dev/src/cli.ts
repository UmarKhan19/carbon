#!/usr/bin/env tsx
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  spinner,
  tasks,
  text
} from "@clack/prompts";
import Table from "cli-table3";
import { execa } from "execa";
import { addDependency } from "nypm";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pc from "picocolors";
import {
  addWorktree,
  branchExists,
  currentBranch,
  listWorktrees as gitListWorktrees,
  isDirty,
  isLinkedWorktree,
  removeWorktree
} from "./lib/git.js";
import { loadEnv } from "./lib/load-env.js";
import {
  getSlot,
  PORT_NAMES,
  removeSlot,
  resolveSlot,
  SHARED_REDIS_PORT
} from "./lib/ports.js";
import { renderEnv, writeEnv } from "./lib/render-env.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlug,
  slugifyBranch
} from "./lib/slug.js";

const COMPOSE_FILE = "docker-compose.dev.yml";

async function main() {
  const cmd = process.argv[2] ?? "up";
  switch (cmd) {
    case "up":
      return await up();
    case "down":
      return await down();
    case "reset":
      return await reset();
    case "status":
      return await status();
    case "new":
      return await newWorktree();
    case "list":
      return await listWorktrees();
    case "remove":
      return await removeWorktreeCmd();
    default:
      console.error(
        `Unknown command: ${cmd}\nUsage: tsx scripts/dev/cli.ts [up|down|reset|status|new|list|remove]`
      );
      process.exit(1);
  }
}

async function up() {
  intro("Carbon · dev up");

  await ensurePortless();

  const selectedApps = await pickApps();

  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  await ensureSlugAvailable(slug, root);
  persistSlug(root, slug);
  log.info(`worktree: ${slug}  (project ${projectName(slug)})`);

  let ports!: Awaited<ReturnType<typeof resolveSlot>>["ports"];
  let redisDb!: number;
  let jwt!: Awaited<ReturnType<typeof resolveSlot>>["jwt"];
  let branchSegment = "";

  await tasks([
    {
      title: "Configure portless",
      task: async () => {
        const slot = await resolveSlot(slug, root);
        ports = slot.ports;
        redisDb = slot.redisDb;
        jwt = slot.jwt;

        // URL pattern: <app>.<branch>.dev — e.g. erp.feat-x.dev, api.feat-x.dev.
        // Override portless's worktree-aware default by writing per-app
        // portless.json with the full name. Each portless name = `<app>.<branch>`.
        const branch = await currentBranch(root);
        branchSegment = branch ? slugifyBranch(branch) : slug;

        for (const id of selectedApps) {
          writePortlessConfig(join(root, "apps", id), {
            name: `${id}.${branchSegment}`,
            script: "dev:app",
          });
        }

        writeEnv(
          root,
          renderEnv({ slug, ports, redisDb, jwt, branchSegment })
        );
        loadEnv(join(root, ".env.local"));
        loadEnv(join(root, ".env"));
        return `branch "${branchSegment}", redis db ${redisDb}`;
      }
    },
    {
      title: "Render .env.local & sync symlinks",
      task: async () => {
        await execStep("tsx", ["scripts/setup-env-files.ts"], root);
        return "env files synced";
      }
    },
    {
      title: "Boot shared redis",
      task: async () => {
        await execStep(
          "docker",
          ["compose", "-f", "docker-compose.yml", "up", "-d", "redis"],
          root
        );
        return `shared redis on :${SHARED_REDIS_PORT} (index ${redisDb})`;
      }
    },
    {
      title: "Boot docker compose stack",
      task: async (msg) => {
        msg("pulling/starting 12 services");
        await execStep(
          "docker",
          [
            "compose",
            "-f",
            COMPOSE_FILE,
            "-p",
            projectName(slug),
            "--env-file",
            ".env.local",
            "up",
            "-d"
          ],
          root
        );
        return "containers up";
      }
    },
    {
      title: "Wait for services",
      task: async (msg) => {
        msg("postgres + kong + inngest");
        await execStep(
          "wait-on",
          [
            "-t",
            "60000",
            `tcp:${ports.PORT_DB}`,
            `tcp:${ports.PORT_API}`,
            `tcp:${ports.PORT_INNGEST}`
          ],
          root
        );
        msg("storage tables");
        await waitForStorageTables(ports.PORT_DB);
        return "all services responding";
      }
    },
    {
      title: "Apply database migrations",
      task: async () => {
        await execStep(
          "supabase",
          [
            "migration",
            "up",
            "--db-url",
            `postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`
          ],
          join(root, "packages/database")
        );
        return "migrations applied";
      }
    },
    {
      title: "Start portless proxy",
      task: async (msg) => {
        cleanStalePortlessRoutes(branchSegment);
        execa("portless", ["proxy", "start"], {
          cwd: root,
          detached: true,
          stdio: "ignore",
          preferLocal: true
        }).unref();
        msg("waiting for proxy on :443");
        await waitForPortlessProxy();
        return "proxy listening";
      }
    },
    {
      title: "Register service aliases",
      task: async () => {
        // Aliases follow the same <app>.<branch> pattern.
        const aliases: { name: string; port: number }[] = [
          { name: `api.${branchSegment}`, port: ports.PORT_API },
          { name: `studio.${branchSegment}`, port: ports.PORT_STUDIO },
          { name: `mail.${branchSegment}`, port: ports.PORT_INBUCKET },
          { name: `inngest.${branchSegment}`, port: ports.PORT_INNGEST }
        ];
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
        return `${aliases.length} aliases registered`;
      }
    }
  ]);

  if (process.env.CARBON_EDITION === "cloud") {
    execa("npm", ["run", "dev:stripe"], {
      cwd: root,
      detached: true,
      stdio: "ignore"
    }).unref();
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  // Print summary BEFORE spawning apps, so it stays visible above app logs.
  note(summaryLines(ports, branchSegment).join("\n"), `Carbon dev — ${slug}`);
  outro("apps starting (Ctrl+C to stop)");

  // Delegate app spawning to turbo + portless. Each app's `dev` script invokes
  // portless, which reads the `"portless"` config in apps/<id>/package.json and
  // runs `dev:app` (react-router dev) behind a stable URL.
  // turbo.json sets `dev` task as `interactive: true` + `ui: "tui"` so turbo
  // forwards a real TTY to portless (otherwise portless aborts in non-TTY mode
  // and prints its help text).
  const filters = selectedApps.flatMap((id) => ["--filter", `./apps/${id}`]);
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const child = execa("turbo", ["run", "dev", ...filters], {
    cwd: root,
    stdio: "inherit",
    preferLocal: true,
    reject: false,
    cancelSignal: ac.signal,
    forceKillAfterDelay: 10_000,
  });
  await child.catch(() => undefined);
}

function writePortlessConfig(
  appDir: string,
  cfg: { name: string; script: string }
) {
  // Per-app portless.json — gitignored, rewritten every dev:up so URLs follow
  // the current branch slug. Overrides any package.json "portless" key.
  writeFileSync(
    join(appDir, "portless.json"),
    JSON.stringify(cfg, null, 2) + "\n"
  );
}

async function execStep(cmd: string, args: string[], cwd: string) {
  const r = await execa(cmd, args, { cwd, reject: false, preferLocal: true });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
}

const PORTLESS_MIN_VERSION = "0.11.0";

async function ensurePortless() {
  // Detect global portless. We do NOT want it as a project dep (per upstream
  // recommendation) — it must live on PATH outside node_modules.
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
    message: `Install portless@latest globally now?`,
    initialValue: true,
  });
  if (isCancel(ok) || !ok) {
    cancel(
      `Aborted. Install manually: ${pc.cyan("npm install -g portless@latest")} or ${pc.cyan("bun install -g portless@latest")}`
    );
    process.exit(1);
  }

  const s = spinner();
  s.start("installing portless@latest globally");
  try {
    await addDependency("portless", { global: true, silent: true });
  } catch (err) {
    s.stop("✗ install failed");
    log.error(
      `Run manually: ${pc.cyan("npm install -g portless@latest")} (or bun/pnpm equivalent)`
    );
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const after = await detectPortlessVersion();
  s.stop(`portless v${after ?? "?"} installed`);
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

async function waitForPortlessProxy() {
  const tldFile = `${homedir()}/.portless/proxy.tld`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;
  const deadline = Date.now() + 30_000;
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

async function down() {
  intro("Carbon · dev down");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  log.info(`stopping ${projectName(slug)} (volumes preserved)`);
  await composeDown(root, slug, false);
  await Promise.all(
    [`api.${slug}`, `studio.${slug}`, `mail.${slug}`, `inngest.${slug}`].map(
      (name) =>
        execa("portless", ["alias", "--remove", name], {
          cwd: root,
          reject: false,
          stdio: "ignore",
          preferLocal: true
        })
    )
  );
  outro("stopped");
}

async function reset() {
  intro("Carbon · dev reset");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);

  if (process.env.CARBON_DEV_YES !== "1") {
    const ok = await confirm({
      message: `Destroy all volumes for ${pc.bold(projectName(slug))}? (postgres, storage, inngest data will be wiped, redis db flushed)`,
      initialValue: false
    });
    if (isCancel(ok) || !ok) {
      cancel("reset aborted");
      process.exit(0);
    }
  }

  log.warn(`resetting ${projectName(slug)}`);
  await composeDown(root, slug, true);
  const slot = getSlot(slug);
  if (slot && typeof slot.redisDb === "number") {
    await flushRedisDb(slot.redisDb);
  }
  await up();
}

async function flushRedisDb(db: number) {
  // Try host redis-cli first, fall back to docker exec into the shared redis container.
  let r = await execa(
    "redis-cli",
    [
      "-h",
      "localhost",
      "-p",
      String(SHARED_REDIS_PORT),
      "-n",
      String(db),
      "FLUSHDB"
    ],
    { reject: false, stdio: "ignore" }
  );
  if (r.exitCode !== 0) {
    r = await execa(
      "docker",
      ["exec", "carbon-redis", "redis-cli", "-n", String(db), "FLUSHDB"],
      { reject: false, stdio: "ignore" }
    );
  }
  if (r.exitCode !== 0) {
    log.warn(`redis flush of db ${db} failed (skipped)`);
  }
}

const APP_CHOICES = [
  { value: "erp", label: "ERP", hint: "main app" },
  { value: "mes", label: "MES", hint: "shop floor" }
] as const;

async function pickApps(): Promise<string[]> {
  // Non-interactive override (CI / scripts).
  const fromEnv = process.env.CARBON_DEV_APPS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Skip prompt if stdin is not a TTY (e.g. piped).
  if (!process.stdin.isTTY) return APP_CHOICES.map((c) => c.value);

  const picked = await multiselect({
    message: "Which apps to run?",
    options: APP_CHOICES.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.hint
    })),
    initialValues: APP_CHOICES.map((c) => c.value),
    required: true
  });
  if (isCancel(picked)) {
    cancel("aborted");
    process.exit(0);
  }
  return picked as string[];
}

async function status() {
  intro("Carbon · dev status");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const slot = getSlot(slug);
  log.info(
    `worktree: ${pc.cyan(slug)}  project: ${pc.cyan(projectName(slug))}`
  );
  if (!slot) {
    log.warn("no port assignment yet — run `npm run dev:up`");
    outro("");
    return;
  }
  const { ports, redisDb } = slot;

  const portsTable = new Table({
    head: [pc.bold("Service"), pc.bold("Port")],
    style: { head: [], border: ["gray"] },
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": ""
    }
  });
  for (const n of PORT_NAMES) {
    portsTable.push([
      pc.cyan(n.replace("PORT_", "").toLowerCase()),
      pc.bold(String(ports[n]))
    ]);
  }
  portsTable.push([
    pc.cyan("redis (shared)"),
    pc.bold(`${SHARED_REDIS_PORT}`) +
      pc.dim(typeof redisDb === "number" ? ` /db ${redisDb}` : " /db ?")
  ]);
  log.message("\n" + portsTable.toString(), {
    symbol: pc.bold(pc.yellow("Portless"))
  });

  const ps = await execa(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      projectName(slug),
      "ps",
      "-a",
      "--format",
      "json"
    ],
    { cwd: root, reject: false }
  );

  if (ps.exitCode !== 0 || !ps.stdout?.trim()) {
    log.warn("no containers running");
    outro("");
    return;
  }

  type Container = {
    Service: string;
    Name: string;
    State: string;
    Status: string;
    Health?: string;
    Publishers?: { PublishedPort: number; TargetPort: number }[] | null;
  };

  // docker compose ps --format json emits NDJSON (one obj per line).
  const containers: Container[] = ps.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const colorState = (state: string, health?: string): string => {
    const s = state.toLowerCase();
    if (s === "running" && health === "unhealthy")
      return pc.yellow("◑ unhealthy");
    if (s === "running" && health === "starting")
      return pc.yellow("◐ starting");
    if (s === "running") return pc.green("● running");
    if (s === "restarting") return pc.yellow("◌ restarting");
    if (s === "exited") return pc.red("✗ exited");
    if (s === "created") return pc.gray("○ created");
    return pc.dim(state);
  };

  const formatPorts = (c: Container): string => {
    if (!c.Publishers || c.Publishers.length === 0) return pc.dim("—");
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of c.Publishers) {
      if (!p.PublishedPort) continue;
      const key = `${p.PublishedPort}:${p.TargetPort}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        `${pc.cyan(String(p.PublishedPort))}${pc.dim("→" + p.TargetPort)}`
      );
    }
    return out.length ? out.join(" ") : pc.dim("—");
  };

  const sorted = [...containers].sort((a, b) =>
    a.Service.localeCompare(b.Service)
  );

  const servicesTable = new Table({
    head: [pc.bold("Service"), pc.bold("Status"), pc.bold("Ports")],
    style: { head: [], border: ["gray"] },
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": ""
    }
  });
  for (const c of sorted) {
    servicesTable.push([
      pc.cyan(c.Service),
      colorState(c.State, c.Health),
      formatPorts(c)
    ]);
  }
  log.message("\n" + servicesTable.toString(), {
    symbol: pc.bold(pc.yellow("Docker"))
  });
  outro("");
}

async function composeDown(root: string, slug: string, withVolumes: boolean) {
  const args = ["compose", "-f", COMPOSE_FILE, "-p", projectName(slug), "down"];
  if (withVolumes) args.push("-v");
  const s = spinner();
  s.start(`docker compose down${withVolumes ? " -v" : ""}`);
  await execa("docker", args, { cwd: root, stdio: "ignore", reject: false });
  s.stop("compose stopped");
}

function cleanStalePortlessRoutes(branchSegment: string) {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return;
  let routes: { hostname: string; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  // Drop alias entries (pid=0) for our compose services on either TLD.
  const services = ["api", "studio", "mail", "inngest"];
  const ourHosts = services.flatMap((s) => [
    `${s}.${branchSegment}.dev`,
    `${s}.${branchSegment}.localhost`,
  ]);
  const before = routes.length;
  const filtered = routes.filter(
    (r) => !(r.pid === 0 && ourHosts.includes(r.hostname))
  );
  if (filtered.length !== before) {
    log.info(`pruned ${before - filtered.length} stale portless route(s)`);
    writeFileSync(path, JSON.stringify(filtered, null, 2));
  }
}

async function waitForStorageTables(port: number) {
  const url = `postgresql://postgres:postgres@localhost:${port}/postgres`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await execa(
      "psql",
      [url, "-tAc", "SELECT to_regclass('storage.buckets')"],
      { env: { ...process.env, PGSSLMODE: "disable" }, reject: false }
    );
    if (r.exitCode === 0 && r.stdout?.trim() === "storage.buckets") return;
    await sleep(1000);
  }
  throw new Error("storage.buckets did not appear within 60s");
}

function link(url: string, text?: string) {
  // OSC 8 hyperlink — supported by iTerm2, Terminal.app, Warp, kitty, etc.
  // Falls back to plain text in unsupported terminals.
  const label = text ?? url;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function summaryLines(
  ports: Record<string, number>,
  branchSegment: string
): string[] {
  type Color = (s: string) => string;
  const row = (color: Color, label: string, url: string, port?: number) => {
    const lbl = color(pc.bold(label.padEnd(8)));
    const target = color(link(url));
    const portTag = port ? `  ${pc.dim(`:${port}`)}` : "";
    return `${lbl}  ${target}${portTag}`;
  };
  const host = (sub: string) => `https://${sub}.${branchSegment}.dev`;
  const dbUrl = `postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`;
  return [
    row(pc.cyan, "ERP", host("erp")),
    row(pc.magenta, "MES", host("mes")),
    row(pc.green, "API", host("api"), ports.PORT_API),
    row(pc.green, "Studio", host("studio"), ports.PORT_STUDIO),
    row(pc.yellow, "Mail", host("mail"), ports.PORT_INBUCKET),
    row(pc.blue, "Inngest", host("inngest"), ports.PORT_INNGEST),
    `${pc.gray(pc.bold("Postgres".padEnd(8)))}  ${pc.gray(dbUrl)}`
  ];
}

// ============================================================================
// Worktree lifecycle: new / list / remove
// ============================================================================

// Reference for git ref name rules: git-check-ref-format(1).
// We allow most chars but reject the documented bad ones.
const INVALID_BRANCH_RE =
  /(^[/-])|([/-]$)|(\.\.)|(@\{)|([\s~^:?*[\\])|(\/{2,})/;

async function promptBranch(): Promise<string> {
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
    if (isCancel(value)) {
      cancel("aborted");
      process.exit(0);
    }
    const trimmed = (value as string).trim();
    if (await branchExists(trimmed)) {
      log.error(
        `Branch '${trimmed}' already exists locally — try another name`
      );
      continue;
    }
    return trimmed;
  }
}

async function promptDirName(
  parentDir: string,
  initial: string
): Promise<string> {
  while (true) {
    const value = await text({
      message: `Worktree directory (relative to ${pc.dim(parentDir)})`,
      initialValue: initial,
      validate(v) {
        if (!v || !v.trim()) return "Directory name required";
        if (/[\s/]/.test(v.trim()))
          return "No spaces or slashes — must be a single dirname";
      }
    });
    if (isCancel(value)) {
      cancel("aborted");
      process.exit(0);
    }
    const trimmed = (value as string).trim();
    if (existsSync(join(parentDir, trimmed))) {
      log.error(`Path '${trimmed}' already exists in ${parentDir}`);
      continue;
    }
    return trimmed;
  }
}

async function newWorktree() {
  intro("Carbon · new worktree");

  const here = await getWorktreeRoot();
  const parentDir = dirname(here);
  const repoBaseName = basename(here).replace(/-[a-z0-9-]+$/i, "");

  const branch = await promptBranch();

  const defaultDir = `${repoBaseName}-${slugifyBranch(branch)}`;
  const dirName = await promptDirName(parentDir, defaultDir);
  const targetPath = resolve(parentDir, dirName);

  const cur = await currentBranch(here);
  const baseOptions: { value: string; label: string }[] = [
    { value: "main", label: "main" }
  ];
  if (cur && cur !== "main") baseOptions.push({ value: cur, label: cur });
  baseOptions.push({ value: "origin/main", label: "origin/main" });

  const baseRef = await select({
    message: "Base ref",
    options: baseOptions,
    initialValue: "main"
  });
  if (isCancel(baseRef)) {
    cancel("aborted");
    process.exit(0);
  }

  const copyEnv = await confirm({
    message: "Copy .env from current worktree?",
    initialValue: true
  });
  if (isCancel(copyEnv)) {
    cancel("aborted");
    process.exit(0);
  }

  await tasks([
    {
      title: `git worktree add ${dirName}`,
      task: async (msg) => {
        msg(`branching from ${baseRef}`);
        const r = await addWorktree({
          path: targetPath,
          branch,
          baseRef: baseRef as string
        });
        if (!r.ok) throw new Error(r.error);
        return `worktree at ${relative(here, targetPath)}`;
      }
    },
    ...(copyEnv === true
      ? [
          {
            title: "Copy .env",
            task: async () => {
              const src = join(here, ".env");
              if (!existsSync(src)) return "no .env in source — skipped";
              copyFileSync(src, join(targetPath, ".env"));
              return ".env copied";
            }
          }
        ]
      : [])
  ]);

  note(
    [
      pc.bold("Next steps:"),
      "",
      `  ${pc.cyan("cd")} ${relative(here, targetPath)}`,
      `  ${pc.cyan("npm install")}    ${pc.dim("# if needed")}`,
      `  ${pc.cyan("npm run dev:up")}`
    ].join("\n"),
    `worktree ready — ${branch}`
  );
  outro("done");
}

async function listWorktrees() {
  intro("Carbon · worktrees");

  const [wtsAll, registry] = await Promise.all([
    gitListWorktrees(),
    Promise.resolve(readPortRegistry())
  ]);
  const wts = wtsAll.filter((w) => !w.bare);

  // Map docker project → status
  const dockerStatus = new Map<string, string>();
  try {
    const r = await execa(
      "docker",
      [
        "ps",
        "-a",
        "--format",
        '{{.Label "com.docker.compose.project"}}\t{{.State}}'
      ],
      { reject: false }
    );
    for (const line of (r.stdout ?? "").split("\n")) {
      const [project, state] = line.split("\t");
      if (!project) continue;
      const prev = dockerStatus.get(project);
      if (state === "running") dockerStatus.set(project, "running");
      else if (!prev) dockerStatus.set(project, state);
    }
  } catch {}

  const table = new Table({
    head: [pc.bold("Worktree"), pc.bold("Branch"), pc.bold("Stack")],
    style: { head: [], border: ["gray"] },
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": ""
    }
  });
  for (const w of wts) {
    const slug = slugForPath(w.path, registry);
    const project = slug ? `carbon-${slug}` : "—";
    const ds = slug ? dockerStatus.get(`carbon-${slug}`) : null;
    const stack = !slug
      ? pc.gray("not initialized")
      : ds === "running"
        ? pc.green(`● up · ${project}`)
        : ds
          ? pc.yellow(`${ds} · ${project}`)
          : pc.dim(`registered · ${project}`);
    table.push([
      w.current ? pc.bold(pc.cyan(w.path)) : w.path,
      w.branch ? pc.cyan(w.branch) : pc.dim("(detached)"),
      stack
    ]);
  }
  log.message("\n" + table.toString(), {
    symbol: pc.bold(pc.yellow("worktrees"))
  });
  outro("");
}

async function removeWorktreeCmd() {
  intro("Carbon · remove worktree");

  const wtsAll = await gitListWorktrees();
  const wts = wtsAll.filter((w) => !w.bare && !w.current);
  if (wts.length === 0) {
    log.warn("no other worktrees to remove");
    outro("");
    return;
  }

  const choice = await select({
    message: "Worktree to remove",
    options: wts.map((w) => ({
      value: w.path,
      label: `${w.branch ?? "(detached)"}  ${pc.dim(w.path)}`
    }))
  });
  if (isCancel(choice)) {
    cancel("aborted");
    process.exit(0);
  }
  const targetPath = choice as string;
  const target = wts.find((w) => w.path === targetPath)!;

  const dirty = await isDirty(targetPath);
  const registry = readPortRegistry();
  const slug = slugForPath(targetPath, registry);
  const projectLabel = slug ? `carbon-${slug}` : "(no stack)";

  const warnings: string[] = [];
  if (dirty) warnings.push(`${pc.yellow("⚠")} uncommitted changes in worktree`);
  if (slug)
    warnings.push(
      `${pc.yellow("⚠")} stack ${projectLabel} will be destroyed (volumes wiped)`
    );

  if (warnings.length) {
    log.warn(warnings.join("\n"));
  }

  const ok = await confirm({
    message: `Permanently remove ${target.branch ?? targetPath} and ${slug ? "wipe its docker volumes" : "the worktree"}?`,
    initialValue: false
  });
  if (isCancel(ok) || !ok) {
    cancel("aborted");
    process.exit(0);
  }

  const slotInfo = slug ? getSlot(slug) : null;
  await tasks([
    ...(slug
      ? [
          {
            title: `docker compose down -v · ${projectLabel}`,
            task: async () => {
              await execa(
                "docker",
                [
                  "compose",
                  "-f",
                  COMPOSE_FILE,
                  "-p",
                  projectLabel,
                  "down",
                  "-v"
                ],
                { cwd: targetPath, stdio: "ignore", reject: false }
              );
              return "stack removed";
            }
          }
        ]
      : []),
    ...(slotInfo && typeof slotInfo.redisDb === "number"
      ? [
          {
            title: `Flush redis db ${slotInfo.redisDb}`,
            task: async () => {
              await flushRedisDb(slotInfo.redisDb);
              return "redis db flushed";
            }
          }
        ]
      : []),
    {
      title: `git worktree remove ${targetPath}`,
      task: async () => {
        const r = await removeWorktree(targetPath, dirty);
        if (!r.ok) throw new Error(r.error);
        return "worktree removed";
      }
    },
    ...(slug
      ? [
          {
            title: "Prune port registry",
            task: async () => {
              removeSlot(slug);
              return `removed ${slug}`;
            }
          }
        ]
      : [])
  ]);

  outro("done");
}

function readPortRegistry(): Record<string, { worktreeRoot: string }> {
  const path = `${homedir()}/.carbon/dev-ports.json`;
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function slugForPath(
  path: string,
  registry: Record<string, { worktreeRoot: string }>
): string | null {
  for (const [slug, entry] of Object.entries(registry)) {
    if (entry.worktreeRoot === path) return slug;
  }
  return null;
}

const invokedAsScript =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("scripts/dev/cli.ts");

if (invokedAsScript) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
