import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { KeyValueBlock } from "../KeyValueBlock";
import { RichTextBlock } from "../RichTextBlock";
import { SharedBlock } from "../SharedBlock";
import { SpacerBlock } from "../SpacerBlock";
import {
  LabelEntityIdBlock,
  LabelHeadingBlock,
  LabelQrCodeBlock,
  LabelQuantityBlock,
  LabelRevisionBlock,
  LabelTrackingBlock
} from "./LabelBlocks";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for a tracking label (per-field elements). */
export const trackingLabelBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer
> = {
  labelHeading: ({ data }) => <LabelHeadingBlock data={data} />,
  labelRevision: ({ data }) => <LabelRevisionBlock data={data} />,
  labelQuantity: ({ data }) => <LabelQuantityBlock data={data} />,
  labelTracking: ({ data }) => <LabelTrackingBlock data={data} />,
  labelQrCode: ({ data }) => <LabelQrCodeBlock data={data} />,
  labelEntityId: ({ data }) => <LabelEntityIdBlock data={data} />,
  header: () => null,
  parties: () => null,
  notes: () => null,
  details: () => null,
  lineItems: () => null,
  summary: () => null,
  terms: () => null,
  jobDetails: () => null,
  operations: () => null,
  issueDetails: () => null,
  associations: () => null,
  actionTasks: () => null,
  reviewers: () => null,
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
  customField: ({ block }) =>
    block.type === "customField" ? (
      <CustomFieldBlock block={block} customFields={{}} />
    ) : null
};
