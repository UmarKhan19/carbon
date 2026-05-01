#!/usr/bin/env tsx
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  ensureSlugAvailable(slug, root);
  persistSlug(root, slug);

  console.log(`▸ worktree: ${slug}  (${projectName(slug)})`);

  const ports = await resolvePorts(slug, root);
  console.log(`▸ ports: ${PORT_NAMES.map((n) => `${n.replace("PORT_", "").toLowerCase()}=${ports[n]}`).join(" ")}`);

  writeEnv(root, renderEnv({ worktreeRoot: root, slug, ports }));
  loadEnv(join(root, ".env"));
  console.log("▸ wrote .env");

  run("npx", ["tsx", "scripts/setup-env-files.ts"], { cwd: root });

  console.log("▸ docker compose up -d");
  composeUp(root, slug);

  console.log("▸ waiting for postgres");
  waitOn([`tcp:${ports.PORT_DB}`]);

  console.log("▸ bootstrapping supabase roles + schemas");
  run(
    "psql",
    [
      `postgresql://supabase_admin:postgres@localhost:${ports.PORT_DB}/postgres`,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      [
        "ALTER USER supabase_auth_admin    WITH PASSWORD 'postgres';",
        "ALTER USER supabase_storage_admin WITH PASSWORD 'postgres';",
        "ALTER USER authenticator          WITH PASSWORD 'postgres';",
        "GRANT anon, authenticated, service_role TO authenticator;",
        "CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;",
      ].join(" "),
    ],
    { cwd: root, allowFailure: true, env: { ...process.env, PGSSLMODE: "disable" } }
  );

  console.log("▸ waiting for gateway + jobs");
  waitOn([`tcp:${ports.PORT_API}`, `tcp:${ports.PORT_INNGEST}`]);

  console.log("▸ waiting for storage tables");
  waitForStorageTables(ports.PORT_DB);

  console.log("▸ applying migrations");
  run("npx", ["tsx", "scripts/migrate.ts"], {
    cwd: join(root, "packages/database"),
  });

  printSummary(slug, ports);

  if (process.env.CARBON_EDITION === "cloud") {
    spawn("npm", ["run", "dev:stripe"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  cleanStalePortlessRoutes(slug);

  console.log("▸ starting apps via portless");
  const apps: { name: string; dir: string; selfUrl: string }[] = [
    { name: `erp.${slug}`, dir: "apps/erp", selfUrl: `https://erp.${slug}.dev` },
    { name: `mes.${slug}`, dir: "apps/mes", selfUrl: `https://mes.${slug}.dev` },
  ];
  // Spawn one portless process per app, wrapping `react-router dev` directly
  // (not through turbo/npm — those don't forward portless's --port injection).
  // First spawn auto-starts the proxy with PORTLESS_TLD from env.
  // VERCEL_URL is overridden per-app so each app's auth redirects/self-links
  // resolve to its own portless host (.env has ERP's URL by default).
  const children = apps.map((app) =>
    spawn(
      "npx",
      ["portless", "--name", app.name, "--", "react-router", "dev"],
      {
        cwd: join(root, app.dir),
        stdio: "inherit",
        env: { ...process.env, VERCEL_URL: app.selfUrl },
      }
    )
  );
  const stop = () => children.forEach((c) => c.kill("SIGTERM"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Wait for proxy to come up with the right TLD before registering aliases.
  // portless writes ~/.portless/proxy.tld once the proxy is live.
  await waitForPortlessProxy();

  console.log("▸ registering portless aliases for compose services");
  const aliases: { name: string; port: number }[] = [
    { name: `api.${slug}`, port: ports.PORT_API },
    { name: `studio.${slug}`, port: ports.PORT_STUDIO },
    { name: `mail.${slug}`, port: ports.PORT_INBUCKET },
    { name: `inngest.${slug}`, port: ports.PORT_INNGEST },
  ];
  for (const a of aliases) {
    run("npx", ["portless", "alias", a.name, String(a.port), "--force"], {
      cwd: root,
      allowFailure: true,
    });
  }

  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((resolve) => {
          c.on("exit", () => resolve());
        })
    )
  );
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
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  console.log(`▸ stopping ${projectName(slug)} (volumes preserved)`);
  composeDown(root, slug, false);
  for (const name of [
    `api.${slug}`,
    `studio.${slug}`,
    `mail.${slug}`,
    `inngest.${slug}`,
  ]) {
    run("npx", ["portless", "alias", "--remove", name], {
      cwd: root,
      allowFailure: true,
    });
  }
}

async function reset() {
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  console.log(`▸ resetting ${projectName(slug)} (volumes will be destroyed)`);
  composeDown(root, slug, true);
  await up();
}

function status() {
  const root = getWorktreeRoot();
  const slug = resolveSlug(root);
  const ports = getPorts(slug);
  console.log(`worktree: ${slug}  project: ${projectName(slug)}`);
  if (!ports) {
    console.log("(no port assignment yet — run `npm run dev:up`)");
    return;
  }
  console.log("\nports:");
  for (const name of PORT_NAMES) {
    console.log(`  ${name.padEnd(18)} ${ports[name]}`);
  }
  console.log("\ncontainers:");
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
}

function composeUp(root: string, slug: string) {
  run(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      projectName(slug),
      "--env-file",
      ".env",
      "up",
      "-d",
    ],
    { cwd: root }
  );
}

function composeDown(root: string, slug: string, withVolumes: boolean) {
  const args = [
    "compose",
    "-f",
    COMPOSE_FILE,
    "-p",
    projectName(slug),
    "down",
  ];
  if (withVolumes) args.push("-v");
  run("docker", args, { cwd: root, allowFailure: true });
}

function waitOn(targets: string[]) {
  run("npx", ["wait-on", "-t", "60000", ...targets], {
    cwd: process.cwd(),
  });
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
    console.log(`▸ pruned ${before - filtered.length} stale portless route(s)`);
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

function printSummary(slug: string, ports: Record<string, number>) {
  const lines = [
    "",
    `  ✓ Carbon dev is up — ${slug}`,
    "",
    `  ERP      https://erp.${slug}.dev`,
    `  MES      https://mes.${slug}.dev`,
    `  API      https://api.${slug}.dev      (:${ports.PORT_API})`,
    `  Studio   https://studio.${slug}.dev   (:${ports.PORT_STUDIO})`,
    `  Mail     https://mail.${slug}.dev     (:${ports.PORT_INBUCKET})`,
    `  Inngest  https://inngest.${slug}.dev  (:${ports.PORT_INNGEST})`,
    `  Postgres postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`,
    "",
  ];
  console.log(lines.join("\n"));
}

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    allowFailure?: boolean;
    env?: NodeJS.ProcessEnv;
  } = { cwd: process.cwd() }
) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: "inherit",
    env: opts.env ?? process.env,
  });
  if (result.status !== 0 && !opts.allowFailure) {
    process.exit(result.status ?? 1);
  }
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
