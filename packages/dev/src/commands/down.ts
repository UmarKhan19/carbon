import { intro, outro, tasks } from "@clack/prompts";
import pc from "picocolors";
import { currentBranch, isLinkedWorktree } from "../lib/git.js";
import { syncAppPortlessConfigs } from "../lib/render-env.js";
import { getWorktreeRoot, projectName, resolveSlug } from "../lib/slug.js";
import { stopStack } from "../services/compose.js";
import { branchToPrefix, unregisterAliases } from "../services/portless.js";

/**
 * Tear down the per-worktree stack.
 *
 * Called both standalone (`crbn down`) and from `up()`'s post-Ctrl+C cleanup.
 * In the post-Ctrl+C path clack's `tasks`/`spinner` would call
 * `process.stdin.setRawMode(true)` and the terminal — which just received
 * SIGINT — throws EIO from the readline interface. We detect that path via
 * the `silent` flag and fall back to a plain printf-style progress log.
 */
export async function down(opts: { silent?: boolean } = {}) {
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const project = projectName(slug);

  if (opts.silent) {
    return runPlain(root, slug, project);
  }

  intro("Carbon · dev down");
  await tasks([
    {
      title: `Stopping ${project} (volumes preserved)`,
      task: async (msg) => {
        msg("docker compose stop");
        await stopStack(root, slug, false);
        return "stack stopped";
      }
    },
    {
      title: "Unregister portless aliases",
      task: async () => {
        const branch = await currentBranch(root);
        const branchPrefix = branchToPrefix(branch);
        await unregisterAliases(root, branchPrefix);
        return "aliases removed";
      }
    },
    {
      title: "Reset app portless.json",
      task: async () => {
        const linked = await isLinkedWorktree();
        syncAppPortlessConfigs({
          worktreeRoot: root,
          branchPrefix: null,
          linked
        });
        return "configs reset";
      }
    }
  ]);
  outro("stopped");
}

async function runPlain(root: string, slug: string, project: string) {
  const step = (msg: string) =>
    process.stderr.write(`${pc.cyan("•")} ${msg}…\n`);
  const done = (msg: string) =>
    process.stderr.write(`${pc.green("✓")} ${msg}\n`);

  step(`stopping ${project} (volumes preserved)`);
  await stopStack(root, slug, false);
  done("stack stopped");

  step("unregistering portless aliases");
  const branch = await currentBranch(root);
  const branchPrefix = branchToPrefix(branch);
  await unregisterAliases(root, branchPrefix);
  done("aliases removed");

  step("resetting app portless.json");
  const linked = await isLinkedWorktree();
  syncAppPortlessConfigs({ worktreeRoot: root, branchPrefix: null, linked });
  done("configs reset");
}
