import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";

/** wait-on the listed TCP targets (`tcp:<port>`). */
export async function waitForTcp(targets: string[], cwd: string) {
  await execStrict("wait-on", ["-t", "60000", ...targets], cwd);
}

/**
 * Block until Supabase storage-api has finished its bootstrap migrations and
 * `storage.buckets` exists in postgres.
 */
export async function waitForStorageTables(port: number) {
  const url = `postgresql://postgres:postgres@localhost:${port}/postgres`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await execa(
      "psql",
      [url, "-tAc", "SELECT to_regclass('storage.buckets')"],
      { env: { ...process.env, PGSSLMODE: "disable" }, reject: false }
    );
    if (r.exitCode === 0 && r.stdout?.trim() === "storage.buckets") return;
    await sleep(1000);
  }
  throw new Error("storage.buckets did not appear within 60s");
}

/** Apply pending Supabase migrations against the worktree's compose postgres. */
export async function applyMigrations(root: string, dbPort: number) {
  await execStrict(
    "supabase",
    [
      "migration",
      "up",
      "--db-url",
      `postgresql://postgres:postgres@localhost:${dbPort}/postgres`
    ],
    join(root, "packages/database")
  );
}

async function execStrict(cmd: string, args: string[], cwd: string) {
  const r = await execa(cmd, args, { cwd, reject: false, preferLocal: true });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
}
