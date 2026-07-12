import type { Database } from "@carbon/database";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { MethodDiffEntry } from "../../changeOrder.models";
import { ParametersPanel } from "./ChangeOrderBopParameters";
import { StepsPanel } from "./ChangeOrderBopSteps";
import { ToolsPanel } from "./ChangeOrderBopTools";

// -----------------------------------------------------------------------------
// Change Order — staged BOP operation children editor.
//
// Renders steps / parameters / tools of a single staged operation with
// add / edit / delete, mirroring the live BillOfProcess child editors but
// posting to the CO staging routes. Diff status badges (added/modified/removed)
// are matched by the staged child row id via the per-operation child diff.
//
// This is a thin Tabs container; each tab's Panel + Row + Form stack lives in a
// focused sibling file (ChangeOrderBop{Steps,Parameters,Tools}.tsx) and they
// share the diff-ui helpers.
// -----------------------------------------------------------------------------

type StagedStep =
  Database["public"]["Tables"]["changeOrderStagedOperationStep"]["Row"];
type StagedParameter =
  Database["public"]["Tables"]["changeOrderStagedOperationParameter"]["Row"];
type StagedTool =
  Database["public"]["Tables"]["changeOrderStagedOperationTool"]["Row"];

type ChildDiff = MethodDiffEntry<Record<string, unknown>>;

export type ChangeOrderBopChildrenData = {
  steps: StagedStep[];
  parameters: StagedParameter[];
  tools: StagedTool[];
};

export type ChangeOrderBopChildrenDiff = {
  steps?: ChildDiff[];
  parameters?: ChildDiff[];
  tools?: ChildDiff[];
};

type ChangeOrderBopChildrenProps = {
  changeOrderId: string;
  affectedId: string;
  operationId: string;
  children: ChangeOrderBopChildrenData;
  diff?: ChangeOrderBopChildrenDiff;
  isDisabled: boolean;
};

export default function ChangeOrderBopChildren({
  changeOrderId,
  affectedId,
  operationId,
  children,
  diff,
  isDisabled
}: ChangeOrderBopChildrenProps) {
  return (
    <Tabs defaultValue="steps" className="w-full">
      <TabsList>
        <TabsTrigger value="steps">
          <Trans>Steps</Trans>
        </TabsTrigger>
        <TabsTrigger value="parameters">
          <Trans>Parameters</Trans>
        </TabsTrigger>
        <TabsTrigger value="tools">
          <Trans>Tools</Trans>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="steps">
        <StepsPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          steps={children.steps}
          diff={diff?.steps}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="parameters">
        <ParametersPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          parameters={children.parameters}
          diff={diff?.parameters}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="tools">
        <ToolsPanel
          changeOrderId={changeOrderId}
          affectedId={affectedId}
          operationId={operationId}
          tools={children.tools}
          diff={diff?.tools}
          isDisabled={isDisabled}
        />
      </TabsContent>
    </Tabs>
  );
}
