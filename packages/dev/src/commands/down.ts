import { intro, log, outro } from "@clack/prompts";
import { currentBranch, isLinkedWorktree } from "../lib/git.js";
import { syncAppPortlessConfigs } from "../lib/render-env.js";
import { getWorktreeRoot, projectName, resolveSlug } from "../lib/slug.js";
import { stopStack } from "../services/compose.js";
import { branchToPrefix, unregisterAliases } from "../services/portless.js";

export async function down() {
  intro("Carbon · dev down");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  log.info(`stopping ${projectName(slug)} (volumes preserved)`);
  await stopStack(root, slug, false);

  const branch = await currentBranch(root);
  const linked = await isLinkedWorktree();
  const branchPrefix = branchToPrefix(branch);
  await unregisterAliases(root, branchPrefix);

  // Drop generated portless.json so a future `up` on a different branch
  // (or a manual `pnpm dev` from this checkout) doesn't reuse a stale name.
  syncAppPortlessConfigs({
    worktreeRoot: root,
    branchPrefix: null,
    linked
  });

  outro("stopped");
}
