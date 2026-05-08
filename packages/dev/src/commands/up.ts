import { join } from "node:path";
import { intro, log, note, outro, tasks } from "@clack/prompts";
import { currentBranch } from "../lib/git.js";
import { loadEnv } from "../lib/load-env.js";
import { resolveSlot, SHARED_REDIS_PORT } from "../lib/ports.js";
import { renderEnv, writeEnv } from "../lib/render-env.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlug,
  slugifyBranch
} from "../lib/slug.js";
import {
  installDeps,
  spawnAppsViaTurbo,
  spawnStripeListener,
  syncEnvSymlinks
} from "../services/apps.js";
import { bootSharedRedis, bootStack } from "../services/compose.js";
import {
  applyMigrations,
  waitForStorageTables,
  waitForTcp
} from "../services/migrations.js";
import {
  ensurePortlessInstalled,
  ensureProxyPrivileges,
  pruneStaleRoutes,
  registerAliases,
  startProxyDaemon,
  syncHostsFile,
  waitForProxyReady,
  writeAppPortlessConfig
} from "../services/portless.js";
import { pickApps } from "../ui/prompts.js";
import { summaryLines } from "../ui/summary.js";

export async function up() {
  intro("Carbon · dev up");

  await ensurePortlessInstalled();
  await ensureProxyPrivileges();

  const selectedApps = await pickApps();

  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  await ensureSlugAvailable(slug, root);
  persistSlug(root, slug);
  log.info(`worktree: ${slug}  (project ${projectName(slug)})`);

  // Install workspace deps first (no-op when in sync). Done outside the
  // clack `tasks` block so pnpm's interactive output streams directly.
  log.step("pnpm install");
  await installDeps(root);

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

        const branch = await currentBranch(root);
        branchSegment = branch ? slugifyBranch(branch) : slug;

        for (const id of selectedApps) {
          writeAppPortlessConfig(join(root, "apps", id), {
            name: `${id}.${branchSegment}`,
            script: "dev:app"
          });
        }

        writeEnv(root, renderEnv({ slug, ports, redisDb, jwt, branchSegment }));
        loadEnv(join(root, ".env.local"));
        loadEnv(join(root, ".env"));
        return `branch "${branchSegment}", redis db ${redisDb}`;
      }
    },
    {
      title: "Render .env.local & sync symlinks",
      task: async () => {
        await syncEnvSymlinks(root);
        return "env files synced";
      }
    },
    {
      title: "Boot shared redis",
      task: async () => {
        await bootSharedRedis(root);
        return `shared redis on :${SHARED_REDIS_PORT} (index ${redisDb})`;
      }
    },
    {
      title: "Boot docker compose stack",
      task: async (msg) => {
        msg("pulling/starting 12 services");
        await bootStack(root, slug);
        return "containers up";
      }
    },
    {
      title: "Wait for services",
      task: async (msg) => {
        msg("postgres + kong + inngest");
        await waitForTcp(
          [
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
        await applyMigrations(root, ports.PORT_DB);
        return "migrations applied";
      }
    },
    {
      title: "Start portless proxy",
      task: async (msg) => {
        pruneStaleRoutes(branchSegment);
        startProxyDaemon(root);
        msg("waiting for proxy on :443");
        await waitForProxyReady();
        return "proxy listening";
      }
    },
    {
      title: "Register service aliases",
      task: async () => {
        const count = await registerAliases(root, branchSegment, ports);
        return `${count} aliases registered`;
      }
    }
  ]);

  // Push the just-registered routes into /etc/hosts. Outside the clack
  // tasks block because sudo's password prompt would clash with the
  // spinner UI; sudo timestamp from ensureProxyPrivileges is usually still
  // fresh so this is silent.
  log.step("sudo portless hosts sync");
  await syncHostsFile();

  if (process.env.CARBON_EDITION === "cloud") {
    spawnStripeListener(root);
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  note(summaryLines(ports, branchSegment).join("\n"), `Carbon dev — ${slug}`);
  outro("apps starting (Ctrl+C to stop)");

  // SIGINT handling lives inside spawnAppsViaTurbo; turbo gets the signal
  // via the process group and we swallow our default exit so it can clean
  // up before we return.
  await spawnAppsViaTurbo({ root, apps: selectedApps });
}
