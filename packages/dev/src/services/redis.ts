import { log } from "@clack/prompts";
import { execa } from "execa";
import { SHARED_REDIS_PORT } from "../lib/ports.js";

/**
 * Wipe one logical Redis DB on the shared instance. Tries host `redis-cli`
 * first, falls back to `docker exec` into the carbon-redis container.
 */
export async function flushDb(db: number) {
  let r = await execa(
    "redis-cli",
    [
      "-h",
      "localhost",
      "-p",
      String(SHARED_REDIS_PORT),
      "-n",
      String(db),
      "FLUSHDB"
    ],
    { reject: false, stdio: "ignore" }
  );
  if (r.exitCode !== 0) {
    r = await execa(
      "docker",
      ["exec", "carbon-redis", "redis-cli", "-n", String(db), "FLUSHDB"],
      { reject: false, stdio: "ignore" }
    );
  }
  if (r.exitCode !== 0) {
    log.warn(`redis flush of db ${db} failed (skipped)`);
  }
}
