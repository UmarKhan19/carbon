import {
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "@carbon/ee/plan";
import { usePlan } from "@carbon/react";
import { useFlags } from "~/hooks/useFlags";

export function usePlanGate(spec: GateSpec) {
  const currentPlan = usePlan();
  const { isCloud } = useFlags();

  const requirement = resolveRequirement(spec);
  const isGated = isCloud && !planMeetsRequirement(currentPlan, requirement);

  return { allowedPlans: requirement, isGated, plan: currentPlan };
}
