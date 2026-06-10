import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { KeyValueBlock } from "../KeyValueBlock";
import { RichTextBlock } from "../RichTextBlock";
import { SharedBlock } from "../SharedBlock";
import { SpacerBlock } from "../SpacerBlock";
import { DetailsBlock } from "./DetailsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { NotesBlock } from "./NotesBlock";
import { PartiesBlock } from "./PartiesBlock";
import { TermsBlock } from "./TermsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for Packing Slip (fulfillment; no summary/pricing). */
export const packingSlipBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer
> = {
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ data }) => <PartiesBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  details: ({ data }) => <DetailsBlock data={data} />,
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  summary: () => null,
  terms: ({ block, data }) =>
    block.type === "terms" ? <TermsBlock block={block} data={data} /> : null,
  jobDetails: () => null,
  operations: () => null,
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
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.shipment?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
