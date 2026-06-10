import type { DocumentBlockType } from "../../../template";
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
  // Labels stay in parity with ZPL — extension/custom blocks are never rendered.
  richText: () => null,
  keyValue: () => null,
  spacer: () => null,
  shared: () => null,
  customField: () => null
};
