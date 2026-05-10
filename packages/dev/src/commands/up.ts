import { join } from "node:path";
import { intro, log, note, outro, tasks } from "@clack/prompts";
import { currentBranch, isLinkedWorktree } from "../lib/git.js";
import { loadEnv } from "../lib/load-env.js";
import { resolveSlot, SHARED_REDIS_PORT } from "../lib/ports.js";
import {
  renderEnv,
  syncAppPortlessConfigs,
  writeEnv
} from "../lib/render-env.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName,
  resolveSlug
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
  branchToPrefix,
  claimAppHosts,
  ensurePortlessInstalled,
  ensureProxyPrivileges,
  hostsFileInSync,
  pruneStaleRoutes,
  registerAliases,
  startProxyDaemon,
  syncHostsFile,
  waitForProxyReady
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

  // Install workspace deps first (skipped when node_modules/.modules.yaml is
  // newer than pnpm-lock.yaml). Done outside the clack `tasks` block so
  // pnpm's interactive output streams directly when it does run.
  const ran = await installDeps(root);
  if (ran) log.step("pnpm install");
  else log.info("pnpm install skipped (lockfile in sync)");

  let ports!: Awaited<ReturnType<typeof resolveSlot>>["ports"];
  let redisDb!: number;
  let jwt!: Awaited<ReturnType<typeof resolveSlot>>["jwt"];
  let branchPrefix: string | null = null;

  await tasks([
    {
      title: "Configure portless",
      task: async () => {
        const slot = await resolveSlot(slug, root);
        ports = slot.ports;
        redisDb = slot.redisDb;
        jwt = slot.jwt;

        // Apply the prefix on every non-default branch, regardless of whether
        // the cwd is a linked worktree. portless only auto-prefixes inside
        // linked worktrees, so for the main checkout we additionally stamp
        // each app's portless.json (see syncAppPortlessConfigs below) to
        // force the same `<prefix>.<app>.dev` shape there.
        const branch = await currentBranch(root);
        const linked = await isLinkedWorktree();
        branchPrefix = branchToPrefix(branch);

        writeEnv(root, renderEnv({ slug, ports, redisDb, jwt, branchPrefix }));
        syncAppPortlessConfigs({ worktreeRoot: root, branchPrefix, linked });
        loadEnv(join(root, ".env.local"));
        loadEnv(join(root, ".env"));
        return `prefix "${branchPrefix ?? "(none)"}", redis db ${redisDb}`;
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
        pruneStaleRoutes(branchPrefix);
        startProxyDaemon(root);
        msg("waiting for proxy on :443");
        await waitForProxyReady();
        return "proxy listening";
      }
    },
    {
      title: "Register service aliases",
      task: async () => {
        const count = await registerAliases(root, branchPrefix, ports);
        return `${count} aliases registered`;
      }
    },
    {
      title: "Reserve app hostnames",
      task: async () => {
        const killed = await claimAppHosts(branchPrefix, selectedApps);
        return killed > 0
          ? `killed ${killed} orphan portless process${killed === 1 ? "" : "es"}`
          : "no orphans found";
      }
    }
  ]);

  // Push the just-registered routes into /etc/hosts. Skipped when every
  // route hostname is already inside the # portless-* block — saves the
  // sudo password prompt on repeat runs of an unchanged worktree. Outside
  // the clack tasks block because sudo's password prompt would clash with
  // the spinner UI when it does run.
  if (hostsFileInSync()) {
    log.info("/etc/hosts already in sync — skipping sudo");
  } else {
    log.step("sudo portless hosts sync");
    await syncHostsFile();
  }

  if (process.env.CARBON_EDITION === "cloud") {
    spawnStripeListener(root);
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  note(summaryLines(ports, branchPrefix).join("\n"), `Carbon dev — ${slug}`);
  outro("apps starting (Ctrl+C to stop)");

  // SIGINT handling lives inside spawnAppsViaTurbo; the spawned portless
  // children get the signal via the process group and we swallow our default
  // exit so they can clean up routes before we return.
  await spawnAppsViaTurbo({ root, apps: selectedApps });
}
