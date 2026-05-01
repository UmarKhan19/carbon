#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { loadEnv } from "./lib/load-env.js";

const root = (() => {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
})();

loadEnv(join(root, ".env"));

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: tsx scripts/dev/with-env.ts <command> [args...]");
  process.exit(1);
}

const expanded = args.map((a) =>
  a.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, k) => process.env[k] ?? "")
);

const result = spawnSync(cmd, expanded, {
  stdio: "inherit",
  env: process.env,
  shell: cmd === "sh" || cmd === "bash",
});
process.exit(result.status ?? 0);
