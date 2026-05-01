#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const repoRoot = (() => {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
})();
loadEnv(join(repoRoot, ".env"));

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL not set (run `npm run dev:up` first)");
  process.exit(1);
}

const migrationsDir = join(repoRoot, "packages/database/supabase/migrations");
if (!existsSync(migrationsDir)) {
  console.error(`migrations dir not found: ${migrationsDir}`);
  process.exit(1);
}

async function run() {
  const client = new pg.Client({ connectionString: dbUrl, ssl: false });
  await client.connect();

  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text NOT NULL PRIMARY KEY,
      statements text[],
      name text
    );
  `);

  const applied = new Set(
    (
      await client.query<{ version: string }>(
        "SELECT version FROM supabase_migrations.schema_migrations"
      )
    ).rows.map((r) => r.version)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = file.replace(/_.*$/, "").replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`▸ ${file}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ($1, $2)",
        [version, file.replace(/\.sql$/, "")]
      );
      await client.query("COMMIT");
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ ${file}`);
      console.error(err instanceof Error ? err.message : err);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(
    appliedCount > 0
      ? `Applied ${appliedCount} migration(s)`
      : "No new migrations"
  );
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
