import type { JSONContent } from "@carbon/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
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

// Right pane of the change-order workspace: all CO-centric content (not tied to
// any single affected item), organized as collapsible sections so the narrow
// column doesn't stack heavy cards. Sections: Properties, Reason for change,
// Description, Actions, and (at Implementation/Done) Impact + Release.
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

  // Open the always-relevant context by default; leave Actions collapsed and
  // open Release only at the moment it matters (Implementation).
  const defaultOpen = ["properties", "reason", "description"];
  if (isImplementation) defaultOpen.push("release");

  return (
    <aside className="w-[420px] flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm">
      <Accordion
        type="multiple"
        defaultValue={defaultOpen}
        className="px-3 pb-4"
      >
        <AccordionItem value="properties">
          <AccordionTrigger>
            <Trans>Properties</Trans>
          </AccordionTrigger>
          <AccordionContent>
            <ChangeOrderProperties />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="reason">
          <AccordionTrigger>
            <Trans>Reason for change</Trans>
          </AccordionTrigger>
          <AccordionContent>
            <ChangeOrderContentSection
              key={`${id}-reason`}
              embedded
              id={id}
              title=""
              field="reasonForChange"
              content={changeOrder.reasonForChange as JSONContent}
              isDisabled={isDisabled}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="description">
          <AccordionTrigger>
            <Trans>Description</Trans>
          </AccordionTrigger>
          <AccordionContent>
            <ChangeOrderContentSection
              key={`${id}-description`}
              embedded
              id={id}
              title=""
              field="description"
              content={changeOrder.description as JSONContent}
              isDisabled={isDisabled}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="actions">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Trans>Actions</Trans>
              {actions.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {actionsDone}/{actions.length}
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <ChangeOrderActions
              embedded
              changeOrderId={id}
              actions={actions}
              isDisabled={isDisabled}
            />
          </AccordionContent>
        </AccordionItem>

        {showImplementation && (
          <AccordionItem value="impact">
            <AccordionTrigger>
              <Trans>Impact</Trans>
            </AccordionTrigger>
            <AccordionContent>
              <ImpactPanel embedded impact={impact} />
            </AccordionContent>
          </AccordionItem>
        )}

        {isImplementation && (
          <AccordionItem value="release">
            <AccordionTrigger>
              <Trans>Release</Trans>
            </AccordionTrigger>
            <AccordionContent>
              <ChangeOrderReleaseMerge
                embedded
                changeOrderId={id}
                status={changeOrder.status}
                conflicts={releaseConflicts}
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </aside>
  );
}
