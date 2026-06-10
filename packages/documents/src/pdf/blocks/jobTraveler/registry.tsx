import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { KeyValueBlock } from "../KeyValueBlock";
import { RichTextBlock } from "../RichTextBlock";
import { SharedBlock } from "../SharedBlock";
import { SpacerBlock } from "../SpacerBlock";
import { HeaderBlock } from "./HeaderBlock";
import { JobDetailsBlock } from "./JobDetailsBlock";
import { NotesBlock } from "./NotesBlock";
import { OperationsBlock } from "./OperationsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Job Traveler (header/jobDetails/operations/notes). */
export const jobTravelerBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer
> = {
  header: ({ data }) => <HeaderBlock data={data} />,
  jobDetails: ({ data }) => <JobDetailsBlock data={data} />,
  operations: ({ data }) => <OperationsBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  parties: () => null,
  details: () => null,
  lineItems: () => null,
  summary: () => null,
  terms: () => null,
  issueDetails: () => null,
  associations: () => null,
  actionTasks: () => null,
  reviewers: () => null,
  labelHeading: () => null,
  labelRevision: () => null,
  labelQuantity: () => null,
  labelTracking: () => null,
  labelQrCode: () => null,
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
  field: () => null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={(data.job?.customFields ?? {}) as Record<string, unknown>}
      />
    ) : null
};
