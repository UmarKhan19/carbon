import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { KeyValueBlock } from "../KeyValueBlock";
import { RichTextBlock } from "../RichTextBlock";
import { SharedBlock } from "../SharedBlock";
import { SpacerBlock } from "../SpacerBlock";
import { ActionTasksBlock } from "./ActionTasksBlock";
import { AssociationsBlock } from "./AssociationsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { IssueDetailsBlock } from "./IssueDetailsBlock";
import { NotesBlock } from "./NotesBlock";
import { ReviewersBlock } from "./ReviewersBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Issue report. */
export const issueBlockRegistry: Record<DocumentBlockType, BlockRenderer> = {
  header: ({ data }) => <HeaderBlock data={data} />,
  issueDetails: ({ data }) => <IssueDetailsBlock data={data} />,
  associations: ({ data }) => <AssociationsBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  actionTasks: ({ data }) => <ActionTasksBlock data={data} />,
  reviewers: ({ data }) => <ReviewersBlock data={data} />,
  parties: () => null,
  details: () => null,
  lineItems: () => null,
  summary: () => null,
  terms: () => null,
  jobDetails: () => null,
  operations: () => null,
  labelHeading: () => null,
  labelRevision: () => null,
  labelQuantity: () => null,
  labelTracking: () => null,
  labelEntityId: () => null,
  richText: ({ block, data }) =>
    block.type === "richText" ? (
      <RichTextBlock block={block} vars={data.vars} />
    ) : null,
  keyValue: ({ block, data }) =>
    block.type === "keyValue" ? (
      <KeyValueBlock block={block} vars={data.vars} />
    ) : null,
  spacer: ({ block }) =>
    block.type === "spacer" ? <SpacerBlock block={block} /> : null,
  shared: ({ block, data }) =>
    block.type === "shared" ? (
      <SharedBlock block={block} sections={data.sections} vars={data.vars} />
    ) : null,
  labelBarcode: () => null,
  labelLogo: () => null,
  field: () => null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.nonConformance?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
