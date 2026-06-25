import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Violation } from "./check";

export type BaselineKey = string;

const BASELINE_PATH = join(process.cwd(), "src/conformance/baseline.json");

export function keyOf(checkId: string, v: Violation): BaselineKey {
  return `${checkId}::${v.file}::${v.snippet}`;
}

/** Pure parse so it is unit-testable without disk. */
export function parseBaseline(json: string | undefined): Set<BaselineKey> {
  if (!json) return new Set();
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? new Set(arr as BaselineKey[]) : new Set();
  } catch {
    return new Set();
  }
}

export function loadBaseline(path = BASELINE_PATH): Set<BaselineKey> {
  try {
    return parseBaseline(readFileSync(path, "utf8"));
  } catch {
    return new Set();
  }
}

export function writeBaseline(keys: BaselineKey[], path = BASELINE_PATH): void {
  writeFileSync(path, `${JSON.stringify([...keys].sort(), null, 2)}\n`);
}
