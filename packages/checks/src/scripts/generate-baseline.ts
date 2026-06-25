import { keyOf, writeBaseline } from "../baseline";
import { scanAll, scanModules } from "../run";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";
import { loadModules, modulesDir } from "../sources/modules";

const root = repoRoot();
const findings = [
  ...scanAll(loadSqlFiles(migrationsDir(root))),
  ...scanModules(loadModules(modulesDir(root)))
];
const keys = [...new Set(findings.map((f) => keyOf(f.checkId, f.violation)))];
writeBaseline(keys);
console.log(`Wrote ${keys.length} baselined conformance violations.`);
