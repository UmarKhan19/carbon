// ERP-side Business Rules module. Re-exports cross-app queries from the
// `@carbon/ee/business-rules` package alongside ERP-only admin CRUD + form
// validators.

export {
  assignBusinessRule,
  getActiveRulesForTargets,
  getBusinessRulesList,
  getRuleAssignmentsForTarget,
  unassignBusinessRule
} from "@carbon/ee/business-rules";
export * from "./businessRules.models";
export * from "./businessRules.service";
