import tab from "@bomb.sh/tab/citty";
import { defineCommand, runMain } from "citty";
import { copy } from "./commands/copy.js";
import { down } from "./commands/down.js";
import { listWorktrees } from "./commands/list.js";
import { migrate } from "./commands/migrate.js";
import { newWorktree } from "./commands/new.js";
import { removeWorktreeCmd } from "./commands/remove.js";
import { reset } from "./commands/reset.js";
import { status } from "./commands/status.js";
import { up } from "./commands/up.js";

const main = defineCommand({
  meta: {
    description:
      "Carbon dev CLI (heavy commands; bash router handles checkout)",
    name: "crbn"
  },
  subCommands: {
    // Stubs so shell completion lists these — the bash router (`bin/crbn`)
    // intercepts them before tsx is invoked. Direct invocation lands here.
    checkout: defineCommand({
      meta: {
        description:
          "Switch into worktree for <branch> (handled by bash router)"
      },
      run: () => {
        console.error("checkout is handled by the bash router (bin/crbn)");
        process.exit(1);
      }
    }),
    copy: defineCommand({
      meta: {
        description:
          "Copy files listed in package.json#crbn.copy from main checkout into cwd"
      },
      run: () => copy()
    }),
    down: defineCommand({
      meta: { description: "Stop the compose stack (volumes preserved)" },
      run: () => down()
    }),
    list: defineCommand({
      meta: { description: "List worktrees with stack status" },
      run: () => listWorktrees()
    }),
    migrate: defineCommand({
      args: {
        regen: {
          default: true,
          description:
            "Regenerate db types + swagger after migrations (use --no-regen to skip)",
          type: "boolean"
        }
      },
      meta: {
        description:
          "Apply database migrations against the worktree's stack (loads .env.local)"
      },
      run: ({ args }) => migrate({ regen: args.regen !== false })
    }),
    new: defineCommand({
      meta: { description: "Interactive: create a worktree on a fresh branch" },
      run: () => newWorktree()
    }),
    remove: defineCommand({
      meta: { description: "Pick a worktree to delete (with stack teardown)" },
      run: () => removeWorktreeCmd()
    }),
    reset: defineCommand({
      meta: { description: "Wipe volumes + flush redis db, then `up`" },
      run: () => reset()
    }),
    status: defineCommand({
      meta: { description: "Show port assignment + container health" },
      run: () => status()
    }),
    up: defineCommand({
      args: {
        apps: {
          default: true,
          description:
            "Spawn ERP/MES dev servers (use --no-apps for services-only boot)",
          type: "boolean"
        },
        migrate: {
          default: true,
          description: "Apply database migrations (use --no-migrate to skip)",
          type: "boolean"
        },
        regen: {
          default: true,
          description:
            "Regenerate db types + swagger after migrations (use --no-regen to skip)",
          type: "boolean"
        }
      },
      meta: { description: "Boot the per-worktree compose stack and apps" },
      run: ({ args }) =>
        up({
          apps: args.apps !== false,
          migrate: args.migrate !== false,
          regen: args.regen !== false
        })
    })
  }
});

await tab(main);
await runMain(main);
