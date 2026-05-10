import { spawnSync } from "node:child_process";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL not set (expected in .env or .env.local)");
  process.exit(1);
}

const r = spawnSync(
  "supabase",
  ["migration", "up", "--db-url", dbUrl, ...process.argv.slice(2)],
  { stdio: "inherit" }
);
process.exit(r.status ?? 1);
