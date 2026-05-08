import { intro, log, outro } from "@clack/prompts";
import { getWorktreeRoot, projectName, resolveSlug } from "../lib/slug.js";
import { stopStack } from "../services/compose.js";
import { unregisterAliases } from "../services/portless.js";

export async function down() {
  intro("Carbon · dev down");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  log.info(`stopping ${projectName(slug)} (volumes preserved)`);
  await stopStack(root, slug, false);
  await unregisterAliases(root, slug);
  outro("stopped");
}
