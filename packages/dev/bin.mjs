#!/usr/bin/env node
// Forward to the TS entry through tsx so we don't need a build step.
// preferLocal makes execa look up `tsx` from the workspace's node_modules/.bin
// without going through `npx` (avoids the install/cache hop).
import { execa } from "execa";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "src/cli.ts");

try {
  await execa("tsx", [cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    preferLocal: true,
  });
} catch (err) {
  if (err && typeof err === "object" && "exitCode" in err) {
    process.exit(/** @type {number} */ (err.exitCode ?? 1));
  }
  throw err;
}
