import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SqlFile = { file: string; contents: string };

const MIGRATIONS_REL = "packages/database/supabase/migrations";

/** Repo root, resolved from the package cwd (Vitest/Turbo run with cwd = packages/core). */
export function repoRoot(): string {
  const root = resolve(process.cwd(), "../..");
  if (!existsSync(join(root, MIGRATIONS_REL))) {
    throw new Error(
      `Could not locate repo root from cwd=${process.cwd()} (resolved ${root}); ${MIGRATIONS_REL} not found.`
    );
  }
  return root;
}

export function migrationsDir(root: string): string {
  return join(root, MIGRATIONS_REL);
}

export function loadSqlFiles(dir: string): SqlFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, contents: readFileSync(join(dir, f), "utf8") }));
}
