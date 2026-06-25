export type Gate = { id: string; cmd: string };
export type GateResult = { id: string; passed: boolean; output: string };
export type Exec = (cmd: string) => { ok: boolean; output: string };

/** The v1 floor: cheap, deterministic, reuses the @carbon/core checks. Add a row to grow. */
export const FLOOR_GATES: Gate[] = [
  { id: "lint", cmd: "pnpm exec biome check" },
  { id: "conformance", cmd: "pnpm --filter @carbon/core test" },
  { id: "clobbers", cmd: "pnpm --filter @carbon/core clobbers" }
];

export function runGates(gates: Gate[], exec: Exec): GateResult[] {
  return gates.map((g) => {
    const r = exec(g.cmd);
    return { id: g.id, passed: r.ok, output: r.output };
  });
}
