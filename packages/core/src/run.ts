import { keyOf, loadBaseline } from "./baseline";
import type { ConformanceCheck, Violation } from "./check";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import {
  loadSqlFiles,
  migrationsDir,
  repoRoot,
  type SqlFile
} from "./sources/migrations";

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  noNumericPrecision,
  noLegacyRls
];

export type Finding = { checkId: string; violation: Violation };

export function scanAll(
  files: SqlFile[],
  checks: ConformanceCheck[] = CONFORMANCE_CHECKS
): Finding[] {
  const out: Finding[] = [];
  for (const { file, contents } of files) {
    for (const check of checks) {
      for (const violation of check.scan(file, contents)) {
        out.push({ checkId: check.id, violation });
      }
    }
  }
  return out;
}

/** Findings in the real migrations that are NOT grandfathered by the baseline. */
export function newViolations(): Finding[] {
  const files = loadSqlFiles(migrationsDir(repoRoot()));
  const baseline = loadBaseline();
  return scanAll(files).filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
