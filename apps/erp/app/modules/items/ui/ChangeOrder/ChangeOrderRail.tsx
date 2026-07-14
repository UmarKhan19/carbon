import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import ChangeOrderActions from "./ChangeOrderActions";
import { ChangeOrderContent } from "./ChangeOrderContent";
import ChangeOrderProperties from "./ChangeOrderProperties";
import ChangeOrderReleaseMerge from "./ChangeOrderReleaseMerge";
import ImpactPanel from "./ImpactPanel";

// Right pane of the change-order workspace: all CO-centric content (not tied to
// any single affected item) — the Properties metadata, Reason for change,
// Description, Actions, and (at Implementation/Done) the downstream Impact and the
// release/merge control. The middle pane owns the per-item BoM/BoP/diff.
export default function ChangeOrderRail({
  id,
  changeOrder,
  actions,
  impact,
  releaseConflicts,
  isDisabled,
  showImplementation
}: {
  id: string;
  changeOrder: ChangeOrder;
  actions: ChangeOrderActionTask[];
  impact: ChangeOrderImpact;
  releaseConflicts: ChangeOrderReleaseConflict[];
  isDisabled: boolean;
  showImplementation: boolean;
}) {
  return (
    <aside className="w-[420px] flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm">
      <VStack spacing={4} className="p-2">
        <ChangeOrderProperties />

        <ChangeOrderContent
          key={id}
          id={id}
          reasonForChange={changeOrder.reasonForChange as JSONContent}
          description={changeOrder.description as JSONContent}
          isDisabled={isDisabled}
        />

        <ChangeOrderActions
          changeOrderId={id}
          actions={actions}
          isDisabled={isDisabled}
        />

        {showImplementation && (
          <>
            <ImpactPanel impact={impact} />
            <ChangeOrderReleaseMerge
              changeOrderId={id}
              status={changeOrder.status}
              conflicts={releaseConflicts}
            />
          </>
        )}
      </VStack>
    </aside>
  );
}
