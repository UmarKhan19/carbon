import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { KeyValueBlock } from "../KeyValueBlock";
import { RichTextBlock } from "../RichTextBlock";
import { SharedBlock } from "../SharedBlock";
import { SpacerBlock } from "../SpacerBlock";
import { DetailsBlock } from "./DetailsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for Stock Transfer (internal; header/details/lines). */
export const stockTransferBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer
> = {
  header: ({ data }) => <HeaderBlock data={data} />,
  details: ({ data }) => <DetailsBlock data={data} />,
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  parties: () => null,
  notes: () => null,
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
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.stockTransfer?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
