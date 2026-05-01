import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PortMap } from "./ports.js";

const MANAGED_BEGIN = "# --- managed by scripts/dev/cli.ts (do not edit by hand) ---";
const MANAGED_END = "# --- user-managed values (preserved on regeneration) ---";

const MANAGED_KEYS = new Set([
  "CARBON_WORKTREE",
  "PORT_DB",
  "PORT_API",
  "PORT_STUDIO",
  "PORT_INBUCKET",
  "PORT_REDIS",
  "PORT_INNGEST",
  "VERCEL_URL",
  "ERP_URL",
  "MES_URL",
  "GTM_URL",
  "DOMAIN",
  "SUPABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI",
  "SUPABASE_AUTH_EXTERNAL_AZURE_REDIRECT_URI",
  "REDIS_URL",
  "INNGEST_BASE_URL",
  "INNGEST_DEV",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PGSSLMODE",
  "PORTLESS_TLD",
]);

// Well-known supabase CLI dev keys (signed with the dev JWT secret).
// Same values supabase start uses today, so existing app code keeps working.
const DEV_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const DEV_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const DEV_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function renderEnv(opts: {
  worktreeRoot: string;
  slug: string;
  ports: PortMap;
}): string {
  const { worktreeRoot, slug, ports } = opts;
  const envPath = join(worktreeRoot, ".env");
  const examplePath = join(worktreeRoot, ".env.example");

  const userLines = readUserLines(envPath, examplePath);
  const managed = managedBlock(slug, ports);

  const userBlock = userLines.length
    ? `\n${MANAGED_END}\n${userLines.join("\n")}\n`
    : `\n${MANAGED_END}\n`;

  return `${managed}${userBlock}`;
}

export function writeEnv(worktreeRoot: string, content: string) {
  writeFileSync(join(worktreeRoot, ".env"), content);
}

function readUserLines(envPath: string, examplePath: string): string[] {
  const source = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : existsSync(examplePath)
      ? readFileSync(examplePath, "utf8")
      : "";
  if (!source) return [];

  const lines = source.split("\n").map((l) => l.trimEnd());

  // If a managed block exists, skip everything from MANAGED_BEGIN through MANAGED_END.
  let inManaged = false;
  const filtered: string[] = [];
  for (const line of lines) {
    if (line === MANAGED_BEGIN) {
      inManaged = true;
      continue;
    }
    if (inManaged) {
      if (line === MANAGED_END) inManaged = false;
      continue;
    }
    filtered.push(line);
  }

  const out: string[] = [];
  for (const line of filtered) {
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (line.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (MANAGED_KEYS.has(key)) continue;
    out.push(line);
  }

  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function managedBlock(slug: string, ports: PortMap): string {
  const lines: string[] = [];
  lines.push(MANAGED_BEGIN);
  lines.push(`CARBON_WORKTREE=${slug}`);
  lines.push("PORTLESS_TLD=dev");
  lines.push("");
  lines.push("# Internal compose ports (apps do not read these directly)");
  for (const [k, v] of Object.entries(ports)) lines.push(`${k}=${v}`);
  lines.push("");
  lines.push("# App-facing URLs (per-worktree portless hostnames)");
  lines.push(`DOMAIN=${slug}.dev`);
  lines.push(`ERP_URL=https://erp.${slug}.dev`);
  lines.push(`MES_URL=https://mes.${slug}.dev`);
  lines.push(`VERCEL_URL=https://erp.${slug}.dev`);
  lines.push(`GTM_URL=https://starter.${slug}.dev`);
  lines.push("");
  lines.push("# Supabase");
  lines.push(`SUPABASE_URL=https://api.${slug}.dev`);
  lines.push(
    `SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`
  );
  lines.push("PGSSLMODE=disable");
  lines.push(`SUPABASE_JWT_SECRET=${DEV_JWT_SECRET}`);
  lines.push(`SUPABASE_ANON_KEY=${DEV_ANON_KEY}`);
  lines.push(`SUPABASE_SERVICE_ROLE_KEY=${DEV_SERVICE_KEY}`);
  lines.push(
    `SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.${slug}.dev/auth/v1/callback`
  );
  lines.push(
    `SUPABASE_AUTH_EXTERNAL_AZURE_REDIRECT_URI=https://api.${slug}.dev/auth/v1/callback`
  );
  lines.push("");
  lines.push("# Aux services");
  lines.push(`REDIS_URL=redis://localhost:${ports.PORT_REDIS}`);
  lines.push("INNGEST_DEV=1");
  lines.push(`INNGEST_BASE_URL=http://localhost:${ports.PORT_INNGEST}`);
  return lines.join("\n");
}
