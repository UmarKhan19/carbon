#!/usr/bin/env tsx
import { execa } from "execa";
import { join } from "node:path";
import { loadEnv } from "./lib/load-env.js";

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

async function run() {
  const root = await (async () => {
    try {
      const r = await execa("git", ["rev-parse", "--show-toplevel"]);
      return r.stdout.trim();
    } catch {
      return process.cwd();
    }
  })();

  loadEnv(join(root, ".env.local"));
  loadEnv(join(root, ".env"));

  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.error("Usage: tsx scripts/dev/with-env.ts <command> [args...]");
    process.exit(1);
  }

  const expanded = args.map((a) =>
    a.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, k) => process.env[k] ?? "")
  );

  const result = await execa(cmd, expanded, {
    stdio: "inherit",
    shell: cmd === "sh" || cmd === "bash",
    reject: false,
  });
  process.exit(result.exitCode ?? 0);
}
