import type { JSONContent } from "@carbon/react";
import { Badge, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import ChangeOrderActions from "./ChangeOrderActions";
import { ChangeOrderContentSection } from "./ChangeOrderContent";
import ChangeOrderProperties from "./ChangeOrderProperties";
import ChangeOrderReleaseMerge from "./ChangeOrderReleaseMerge";
import ImpactPanel from "./ImpactPanel";

// A flat CO-centric section — mirrors the Properties panel's own section style
// (xxs uppercase heading + content), so the whole rail reads as one consistent
// sidebar instead of stacked cards. Sections are separated by the parent's
// divide-y, per the app's sidebar idiom (whitespace + subtle dividers, not cards).
function RailSection({
  title,
  accessory,
  children
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-4 py-4">
      <HStack className="w-full justify-between">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          {title}
        </h3>
        {accessory}
      </HStack>
      <div className="pt-3">{children}</div>
    </section>
  );
}

// Right pane of the change-order workspace: all CO-centric content (not tied to
// any single affected item), as one consistent sidebar — Properties, Reason for
// change, Description, Actions, and (at Implementation/Done) Impact + Release.
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
  const isImplementation = changeOrder.status === "Implementation";
  const actionsDone = actions.filter(
    (a) => a.status === "Completed" || a.status === "Skipped"
  ).length;

  return (
    <aside className="w-[420px] flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm">
      <div className="flex flex-col divide-y divide-border">
        {/* Properties renders its own "Properties" heading + fields. */}
        <ChangeOrderProperties />

        <RailSection title={<Trans>Reason for change</Trans>}>
          <ChangeOrderContentSection
            key={`${id}-reason`}
            embedded
            id={id}
            title=""
            field="reasonForChange"
            content={changeOrder.reasonForChange as JSONContent}
            isDisabled={isDisabled}
          />
        </RailSection>

        <RailSection title={<Trans>Description</Trans>}>
          <ChangeOrderContentSection
            key={`${id}-description`}
            embedded
            id={id}
            title=""
            field="description"
            content={changeOrder.description as JSONContent}
            isDisabled={isDisabled}
          />
        </RailSection>

        <RailSection
          title={<Trans>Actions</Trans>}
          accessory={
            actions.length > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {actionsDone}/{actions.length}
              </Badge>
            ) : undefined
          }
        >
          <ChangeOrderActions
            embedded
            changeOrderId={id}
            actions={actions}
            isDisabled={isDisabled}
          />
        </RailSection>

        {showImplementation && (
          <RailSection title={<Trans>Impact</Trans>}>
            <ImpactPanel embedded impact={impact} />
          </RailSection>
        )}

        {isImplementation && (
          <RailSection title={<Trans>Release</Trans>}>
            <ChangeOrderReleaseMerge
              embedded
              changeOrderId={id}
              status={changeOrder.status}
              conflicts={releaseConflicts}
            />
          </RailSection>
        )}
      </div>
    </aside>
  );
}
