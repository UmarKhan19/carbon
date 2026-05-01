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
  spinner,
  tasks,
} from "@clack/prompts";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { loadEnv } from "./lib/load-env.js";
import { PORT_NAMES, getPorts, resolvePorts } from "./lib/ports.js";
import { renderEnv, writeEnv } from "./lib/render-env.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlug,
} from "./lib/slug.js";

const COMPOSE_FILE = "docker-compose.dev.yml";

async function main() {
  const cmd = process.argv[2] ?? "up";
  switch (cmd) {
    case "up":
      return await up();
    case "down":
      return down();
    case "reset":
      return await reset();
    case "status":
      return status();
    default:
      console.error(
        `Unknown command: ${cmd}\nUsage: tsx scripts/dev/cli.ts [up|down|reset|status]`
      );
      process.exit(1);
  }
}

async function up() {
  intro("Carbon · dev up");

  const selectedApps = await pickApps();

  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  ensureSlugAvailable(slug, root);
  persistSlug(root, slug);
  log.info(`worktree: ${slug}  (project ${projectName(slug)})`);

  const ports = await resolvePorts(slug, root);
  log.info(
    `ports: ${PORT_NAMES.map((n) => `${n.replace("PORT_", "").toLowerCase()}=${ports[n]}`).join(" ")}`
  );

  writeEnv(root, renderEnv({ slug, ports }));
  loadEnv(join(root, ".env.local"));
  loadEnv(join(root, ".env"));

  await tasks([
    {
      title: "Render .env.local & sync symlinks",
      task: async () => {
        await execStep("npx", ["tsx", "scripts/setup-env-files.ts"], root);
        return "env files synced";
      },
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
            "-d",
          ],
          root
        );
        return "containers up";
      },
    },
    {
      title: "Wait for services",
      task: async (msg) => {
        msg("postgres + kong + inngest");
        await execStep(
          "npx",
          [
            "wait-on",
            "-t",
            "60000",
            `tcp:${ports.PORT_DB}`,
            `tcp:${ports.PORT_API}`,
            `tcp:${ports.PORT_INNGEST}`,
          ],
          root
        );
        msg("storage tables");
        waitForStorageTables(ports.PORT_DB);
        return "all services responding";
      },
    },
    {
      title: "Apply database migrations",
      task: async () => {
        await execStep(
          "npx",
          ["tsx", "scripts/migrate.ts"],
          join(root, "packages/database")
        );
        return "migrations applied";
      },
    },
    {
      title: "Start portless proxy",
      task: async (msg) => {
        cleanStalePortlessRoutes(slug);
        spawn("npx", ["portless", "proxy", "start"], {
          cwd: root,
          stdio: "ignore",
          detached: true,
          env: process.env,
        }).unref();
        msg("waiting for proxy on :443");
        await waitForPortlessProxy();
        return "proxy listening";
      },
    },
    {
      title: "Register service aliases",
      task: async () => {
        const aliases: { name: string; port: number }[] = [
          { name: `api.${slug}`, port: ports.PORT_API },
          { name: `studio.${slug}`, port: ports.PORT_STUDIO },
          { name: `mail.${slug}`, port: ports.PORT_INBUCKET },
          { name: `inngest.${slug}`, port: ports.PORT_INNGEST },
        ];
        for (const a of aliases) {
          silentRun(
            "npx",
            ["portless", "alias", a.name, String(a.port), "--force"],
            root
          );
        }
        return `${aliases.length} aliases registered`;
      },
    },
  ]);

  if (process.env.CARBON_EDITION === "cloud") {
    spawn("npm", ["run", "dev:stripe"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    }).unref();
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  // Print summary BEFORE spawning apps, so it stays visible above app logs.
  note(summaryLines(slug, ports).join("\n"), `Carbon dev — ${slug}`);
  outro("apps starting (Ctrl+C to stop)");

  const apps = selectedApps.map((id) => ({
    name: `${id}.${slug}`,
    dir: `apps/${id}`,
    selfUrl: `https://${id}.${slug}.dev`,
  }));
  const children = apps.map((app) => spawnApp(root, app));
  const stop = () => children.forEach((c) => c.kill("SIGTERM"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((resolve) => {
          c.on("exit", () => resolve());
        })
    )
  );
}

function spawnApp(
  root: string,
  app: { name: string; dir: string; selfUrl: string }
) {
  const tag = app.name.split(".")[0]; // "erp" or "mes"
  const child = spawn(
    "npx",
    ["portless", "--name", app.name, "--", "react-router", "dev"],
    {
      cwd: join(root, app.dir),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VERCEL_URL: app.selfUrl },
    }
  );
  prefixStream(child.stdout!, tag);
  prefixStream(child.stderr!, tag, true);
  return child;
}

function prefixStream(stream: NodeJS.ReadableStream, tag: string, err = false) {
  const out = err ? process.stderr : process.stdout;
  const colors: Record<string, (s: string) => string> = {
    erp: pc.cyan,
    mes: pc.magenta,
  };
  const color = colors[tag] ?? pc.white;
  const prefix = color(`[${tag}]`) + " ";
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) continue;
      out.write(prefix + line + "\n");
    }
  });
  stream.on("end", () => {
    if (buf.length > 0) out.write(prefix + buf + "\n");
  });
}

async function execStep(cmd: string, args: string[], cwd: string) {
  const result = spawnSync(cmd, args, { cwd, stdio: "pipe", env: process.env });
  if (result.status !== 0) {
    process.stderr.write(result.stderr?.toString() ?? "");
    process.stdout.write(result.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status})`);
  }
}

function silentRun(cmd: string, args: string[], cwd: string) {
  spawnSync(cmd, args, { cwd, stdio: "ignore", env: process.env });
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
        await new Promise((r) => setTimeout(r, 500));
        return;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function down() {
  intro("Carbon · dev down");
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  log.info(`stopping ${projectName(slug)} (volumes preserved)`);
  composeDown(root, slug, false);
  for (const name of [
    `api.${slug}`,
    `studio.${slug}`,
    `mail.${slug}`,
    `inngest.${slug}`,
  ]) {
    silentRun("npx", ["portless", "alias", "--remove", name], root);
  }
  outro("stopped");
}

async function reset() {
  intro("Carbon · dev reset");
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);

  if (process.env.CARBON_DEV_YES !== "1") {
    const ok = await confirm({
      message: `Destroy all volumes for ${pc.bold(projectName(slug))}? (postgres, storage, redis, inngest data will be wiped)`,
      initialValue: false,
    });
    if (isCancel(ok) || !ok) {
      cancel("reset aborted");
      process.exit(0);
    }
  }

  log.warn(`resetting ${projectName(slug)}`);
  composeDown(root, slug, true);
  await up();
}

const APP_CHOICES = [
  { value: "erp", label: "ERP", hint: "main app" },
  { value: "mes", label: "MES", hint: "shop floor" },
] as const;

async function pickApps(): Promise<string[]> {
  // Non-interactive override (CI / scripts).
  const fromEnv = process.env.CARBON_DEV_APPS;
  if (fromEnv) {
    return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Skip prompt if stdin is not a TTY (e.g. piped).
  if (!process.stdin.isTTY) return APP_CHOICES.map((c) => c.value);

  const picked = await multiselect({
    message: "Which apps to run?",
    options: APP_CHOICES.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.hint,
    })),
    initialValues: APP_CHOICES.map((c) => c.value),
    required: true,
  });
  if (isCancel(picked)) {
    cancel("aborted");
    process.exit(0);
  }
  return picked as string[];
}

function status() {
  intro("Carbon · dev status");
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  const ports = getPorts(slug);
  log.info(`worktree: ${slug}  project: ${projectName(slug)}`);
  if (!ports) {
    log.warn("no port assignment yet — run `npm run dev:up`");
    outro("");
    return;
  }
  log.message(
    PORT_NAMES.map((n) => `  ${n.padEnd(18)} ${ports[n]}`).join("\n"),
    { symbol: "ports" }
  );
  spawnSync(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      projectName(slug),
      "ps",
      "--format",
      "table {{.Service}}\\t{{.Status}}\\t{{.Ports}}",
    ],
    { cwd: root, stdio: "inherit" }
  );
  outro("");
}

function composeDown(root: string, slug: string, withVolumes: boolean) {
  const args = ["compose", "-f", COMPOSE_FILE, "-p", projectName(slug), "down"];
  if (withVolumes) args.push("-v");
  const s = spinner();
  s.start(`docker compose down${withVolumes ? " -v" : ""}`);
  spawnSync("docker", args, { cwd: root, stdio: "ignore" });
  s.stop("compose stopped");
}

function cleanStalePortlessRoutes(slug: string) {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return;
  let routes: { hostname: string; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  // Drop any alias (pid=0) whose hostname has our slug — they may be from a
  // previous TLD and would otherwise linger forever.
  const slugSegment = `.${slug}.`;
  const before = routes.length;
  const filtered = routes.filter(
    (r) => !(r.pid === 0 && r.hostname.includes(slugSegment))
  );
  if (filtered.length !== before) {
    log.info(`pruned ${before - filtered.length} stale portless route(s)`);
    writeFileSync(path, JSON.stringify(filtered, null, 2));
  }
}

function waitForStorageTables(port: number) {
  const url = `postgresql://postgres:postgres@localhost:${port}/postgres`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = spawnSync(
      "psql",
      [url, "-tAc", "SELECT to_regclass('storage.buckets')"],
      { env: { ...process.env, PGSSLMODE: "disable" }, encoding: "utf8" }
    );
    if (r.status === 0 && r.stdout?.trim() === "storage.buckets") return;
    spawnSync("sleep", ["1"]);
  }
  throw new Error("storage.buckets did not appear within 60s");
}

function link(url: string, text?: string) {
  // OSC 8 hyperlink — supported by iTerm2, Terminal.app, Warp, kitty, etc.
  // Falls back to plain text in unsupported terminals.
  const label = text ?? url;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function summaryLines(slug: string, ports: Record<string, number>): string[] {
  type Color = (s: string) => string;
  const row = (color: Color, label: string, url: string, port?: number) => {
    const lbl = color(pc.bold(label.padEnd(8)));
    const target = color(link(url));
    const portTag = port ? `  ${pc.dim(`:${port}`)}` : "";
    return `${lbl}  ${target}${portTag}`;
  };
  const dbUrl = `postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`;
  return [
    row(pc.cyan, "ERP", `https://erp.${slug}.dev`),
    row(pc.magenta, "MES", `https://mes.${slug}.dev`),
    row(pc.green, "API", `https://api.${slug}.dev`, ports.PORT_API),
    row(pc.green, "Studio", `https://studio.${slug}.dev`, ports.PORT_STUDIO),
    row(pc.yellow, "Mail", `https://mail.${slug}.dev`, ports.PORT_INBUCKET),
    row(pc.blue, "Inngest", `https://inngest.${slug}.dev`, ports.PORT_INNGEST),
    `${pc.gray(pc.bold("Postgres".padEnd(8)))}  ${pc.gray(dbUrl)}`,
  ];
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
