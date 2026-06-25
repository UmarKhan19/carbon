export type {
  ConformanceCheck,
  ModuleDir,
  StructureCheck,
  Violation
} from "./check";
export { moduleShape } from "./conformance/module-shape";
export { noLegacyRls } from "./conformance/no-legacy-rls";
export { noNumericPrecision } from "./conformance/no-numeric-precision";
export {
  CONFORMANCE_CHECKS,
  type Finding,
  newViolations,
  STRUCTURE_CHECKS,
  scanAll,
  scanModules
} from "./run";
export { loadModules, modulesDir } from "./sources/modules";
