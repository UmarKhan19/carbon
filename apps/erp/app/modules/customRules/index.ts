// ERP-side Custom Rules module. Re-exports cross-app queries from the
// `@carbon/ee/custom-rules` package alongside ERP-only admin CRUD + form
// validators.

export {
  assignCustomRule,
  getActiveRulesForTargets,
  getCustomRulesList,
  getRuleAssignmentsForTarget,
  unassignCustomRule
} from "@carbon/ee/custom-rules";
export * from "./customRules.models";
export * from "./customRules.service";
