import { defineCommand, runMain } from "citty";
import { copy } from "./commands/copy.js";
import { down } from "./commands/down.js";
import { listWorktrees } from "./commands/list.js";
import { newWorktree } from "./commands/new.js";
import { removeWorktreeCmd } from "./commands/remove.js";
import { reset } from "./commands/reset.js";
import { status } from "./commands/status.js";
import { up } from "./commands/up.js";

const main = defineCommand({
  meta: {
    name: "crbn",
    description:
      "Carbon dev CLI (heavy commands; bash router handles checkout/go)"
  },
  subCommands: {
    up: defineCommand({
      meta: { description: "Boot the per-worktree compose stack and apps" },
      run: () => up()
    }),
    down: defineCommand({
      meta: { description: "Stop the compose stack (volumes preserved)" },
      run: () => down()
    }),
    reset: defineCommand({
      meta: { description: "Wipe volumes + flush redis db, then `up`" },
      run: () => reset()
    }),
    status: defineCommand({
      meta: { description: "Show port assignment + container health" },
      run: () => status()
    }),
    new: defineCommand({
      meta: { description: "Interactive: create a worktree on a fresh branch" },
      run: () => newWorktree()
    }),
    list: defineCommand({
      meta: { description: "List worktrees with stack status" },
      run: () => listWorktrees()
    }),
    remove: defineCommand({
      meta: { description: "Pick a worktree to delete (with stack teardown)" },
      run: () => removeWorktreeCmd()
    }),
    copy: defineCommand({
      meta: {
        description:
          "Copy files listed in package.json#crbn.copy from main checkout into cwd"
      },
      run: () => copy()
    })
  }
});

await runMain(main);
