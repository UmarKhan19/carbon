import { keyOf, writeBaseline } from "../baseline";
import { scanAll } from "../run";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";

const files = loadSqlFiles(migrationsDir(repoRoot()));
const keys = scanAll(files).map((f) => keyOf(f.checkId, f.violation));
writeBaseline(keys);
console.log(`Wrote ${keys.length} baselined conformance violations.`);
