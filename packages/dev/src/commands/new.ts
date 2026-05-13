import { copyFileSync, existsSync } from "node:fs";
import { intro, outro, tasks } from "@clack/prompts";
import { basename, dirname, join, relative, resolve } from "pathe";
import pc from "picocolors";
import { addWorktree, currentBranch } from "../git.js";
import {
  promptBaseRef,
  promptBranch,
  promptCopyEnv,
  promptDirName
} from "../prompts.js";
import { getWorktreeRoot, slugify } from "../worktree.js";

export async function newWorktree() {
  intro("Carbon · new worktree");

  const here = await getWorktreeRoot();
  const parentDir = dirname(here);
  const repoBaseName = basename(here).replace(/-[a-z0-9-]+$/i, "");

  const branch = await promptBranch();

  const defaultDir = `${repoBaseName}-${slugify(branch)}`;
  const dirName = await promptDirName(parentDir, defaultDir);
  const targetPath = resolve(parentDir, dirName);

  const cur = await currentBranch(here);
  const baseRef = await promptBaseRef(cur || null);

  const copyEnv = await promptCopyEnv();

  await tasks([
    {
      task: async (msg) => {
        msg(`branching from ${baseRef}`);
        await addWorktree({ baseRef, branch, path: targetPath });
        return `worktree at ${relative(here, targetPath)}`;
      },
      title: `git worktree add ${dirName}`
    },
    ...(copyEnv
      ? [
          {
            task: async () => {
              const src = join(here, ".env");
              if (!existsSync(src)) return "no .env in source — skipped";
              copyFileSync(src, join(targetPath, ".env"));
              return ".env copied";
            },
            title: "Copy .env"
          }
        ]
      : [])
  ]);

  outro(
    `worktree ready — ${pc.cyan(`crbn checkout ${branch} --up`)} to boot it`
  );
}
