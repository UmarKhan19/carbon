import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import {
  LabelEntityIdBlock,
  LabelFieldBlock,
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
  // Single-line fields are supported (and mirrored in ZPL). Rich text /
  // key-value lists / spacers / shared sections are not.
  field: ({ block, data }) =>
    block.type === "field" ? (
      <LabelFieldBlock block={block} data={data} />
    ) : null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={(data.item.customFields ?? {}) as Record<string, unknown>}
      />
    ) : null,
  richText: () => null,
  keyValue: () => null,
  spacer: () => null,
  shared: () => null
};
