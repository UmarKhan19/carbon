import type { JSONContent } from "@carbon/react";
import { z } from "zod";

/**
 * Tiptap document content. We keep validation loose (the editor owns the real
 * shape) and only pin the static TS type — mirrors how `terms` is stored.
 */
const jsonContentSchema = z.custom<JSONContent>(
  (val) => typeof val === "object" && val !== null
);

/** Fields shared by every block, built-in or extension. */
const baseFields = {
  id: z.string(),
  visible: z.boolean().default(true)
};

/**
 * Built-in blocks map 1:1 to the hardcoded sections of a document. They are
 * data-bound (the renderer fills them from the document) so they carry no
 * user-authored props — only identity + visibility.
 */
const builtInBlock = <T extends string>(type: T) =>
  z.object({ ...baseFields, type: z.literal(type) });

/** Per-block display options for the Header block (logo + which fields show). */
export const DEFAULT_HEADER_OPTIONS = {
  showLogo: true,
  logoHeight: 50,
  showCompanyDetails: true,
  showDocumentTitle: true,
  showDocumentId: true
} as const;

export const headerOptionsSchema = z.object({
  showLogo: z.boolean().default(true),
  logoHeight: z.number().min(16).max(120).default(50),
  showCompanyDetails: z.boolean().default(true),
  showDocumentTitle: z.boolean().default(true),
  showDocumentId: z.boolean().default(true)
});

/** Per-block display options for the Line Items table. */
export const DEFAULT_LINE_ITEMS_OPTIONS = {
  showThumbnails: true,
  zebra: true
} as const;

const lineItemsOptionsSchema = z.object({
  showThumbnails: z.boolean().default(true),
  zebra: z.boolean().default(true)
});

/** Per-block options for the Summary totals. */
export const DEFAULT_SUMMARY_OPTIONS = {
  taxLabel: "Taxes"
} as const;

const summaryOptionsSchema = z.object({
  taxLabel: z.string().default("Taxes")
});

const headerBlock = z.object({
  ...baseFields,
  type: z.literal("header"),
  options: headerOptionsSchema.optional()
});
const partiesBlock = builtInBlock("parties");
const notesBlock = builtInBlock("notes");
/** Data-bound metadata block (e.g. shipment/transfer details). */
const detailsBlock = builtInBlock("details");
const lineItemsBlock = z.object({
  ...baseFields,
  type: z.literal("lineItems"),
  options: lineItemsOptionsSchema.optional()
});
const summaryBlock = z.object({
  ...baseFields,
  type: z.literal("summary"),
  options: summaryOptionsSchema.optional()
});
/**
 * Terms & Conditions. Built-in (not addable/removable) but carries its own
 * rich-text `content` — per-document, seeded from the company terms setting.
 * Empty content falls back to that setting at render time.
 */
const termsBlock = z.object({
  ...baseFields,
  type: z.literal("terms"),
  content: jsonContentSchema.optional()
});
/** Job Traveler built-ins (data-bound; render the existing bespoke content). */
const jobDetailsBlock = builtInBlock("jobDetails");
const operationsBlock = builtInBlock("operations");
/** Issue built-ins (data-bound; render the existing bespoke content). */
const issueDetailsBlock = builtInBlock("issueDetails");
const associationsBlock = builtInBlock("associations");
const actionTasksBlock = builtInBlock("actionTasks");
const reviewersBlock = builtInBlock("reviewers");
/** Tracking-label fields (data-bound; one per label element). */
const labelHeadingBlock = builtInBlock("labelHeading");
const labelRevisionBlock = builtInBlock("labelRevision");
const labelQuantityBlock = builtInBlock("labelQuantity");
const labelTrackingBlock = builtInBlock("labelTracking");
const labelQrCodeBlock = builtInBlock("labelQrCode");
const labelEntityIdBlock = builtInBlock("labelEntityId");

/** Extension blocks are user-authored and fully removable. */
const richTextBlock = z.object({
  ...baseFields,
  type: z.literal("richText"),
  title: z.string().optional(),
  content: jsonContentSchema
});

const keyValueBlock = z.object({
  ...baseFields,
  type: z.literal("keyValue"),
  title: z.string().optional(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })).default([])
});

const spacerBlock = z.object({
  ...baseFields,
  type: z.literal("spacer"),
  variant: z.enum(["space", "divider", "pageBreak"]).default("space"),
  /** Height in pt, only used by the "space" variant. */
  size: z.number().min(0).max(200).optional()
});

/** Reference to a shared documentSection, resolved at render time. */
const sharedBlock = z.object({
  ...baseFields,
  type: z.literal("shared"),
  sectionId: z.string()
});

/** Displays a single custom-field value (label + value) from the record. */
const customFieldBlock = z.object({
  ...baseFields,
  type: z.literal("customField"),
  /** The custom field's id (key into the record's `customFields` JSON). */
  fieldId: z.string(),
  /** Display label — defaults to the field's name at insert time. */
  label: z.string().default("")
});

export const blockSchema = z.discriminatedUnion("type", [
  headerBlock,
  partiesBlock,
  notesBlock,
  detailsBlock,
  lineItemsBlock,
  summaryBlock,
  termsBlock,
  jobDetailsBlock,
  operationsBlock,
  issueDetailsBlock,
  associationsBlock,
  actionTasksBlock,
  reviewersBlock,
  labelHeadingBlock,
  labelRevisionBlock,
  labelQuantityBlock,
  labelTrackingBlock,
  labelQrCodeBlock,
  labelEntityIdBlock,
  richTextBlock,
  keyValueBlock,
  spacerBlock,
  sharedBlock,
  customFieldBlock
]);

/** Shared, reusable rich-text section. `placement` scopes where it's used. */
export const documentSectionPlacementSchema = z.enum([
  "body",
  "header",
  "footer"
]);

/**
 * Layout config carried by a header section — logo + which company fields show.
 * Global: the header is one shared section reused across every document.
 */
export const sectionConfigSchema = headerOptionsSchema.partial();

export const documentSectionSchema = z.object({
  name: z.string().min(1),
  placement: documentSectionPlacementSchema.default("body"),
  content: jsonContentSchema,
  config: sectionConfigSchema.optional()
});

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export const DEFAULT_THEME = {
  /** Strong brand color — fills the line-items header bar. */
  accent: "#1f2937",
  /** Text/icons drawn on top of the accent color. */
  accentForeground: "#ffffff"
} as const;

export const themeSchema = z.object({
  accent: z.string().regex(HEX_COLOR).default(DEFAULT_THEME.accent),
  accentForeground: z
    .string()
    .regex(HEX_COLOR)
    .default(DEFAULT_THEME.accentForeground)
});

/**
 * Document body fonts. "Inter" is registered in Template; the rest are the
 * react-pdf built-in PDF standard fonts (no registration needed).
 */
export const DOCUMENT_FONTS = [
  // Inter is registered in Template; Helvetica/Times/Courier are PDF built-ins.
  { value: "Inter", label: "Inter", kind: "Sans" },
  { value: "Helvetica", label: "Helvetica", kind: "Sans" },
  { value: "Times-Roman", label: "Times", kind: "Serif" },
  { value: "Courier", label: "Courier", kind: "Mono" },
  // Google fonts — registered on demand at render (see pdf/fonts.ts).
  { value: "Roboto", label: "Roboto", kind: "Sans" },
  { value: "Open Sans", label: "Open Sans", kind: "Sans" },
  { value: "Lato", label: "Lato", kind: "Sans" },
  { value: "Montserrat", label: "Montserrat", kind: "Sans" },
  { value: "Merriweather", label: "Merriweather", kind: "Serif" },
  { value: "Playfair Display", label: "Playfair Display", kind: "Serif" },
  { value: "Lora", label: "Lora", kind: "Serif" }
] as const;

export type DocumentFont = (typeof DOCUMENT_FONTS)[number]["value"];

/** Document-level settings (font + footer page numbers + registration line). */
export const DEFAULT_DOCUMENT_SETTINGS = {
  fontFamily: "Inter",
  showPageNumbers: true,
  pageNumberFormat: "pageOfTotal",
  showRegistrationLine: true
} as const;

export const documentSettingsSchema = z.object({
  fontFamily: z
    .enum([
      "Inter",
      "Helvetica",
      "Times-Roman",
      "Courier",
      "Roboto",
      "Open Sans",
      "Lato",
      "Montserrat",
      "Merriweather",
      "Playfair Display",
      "Lora"
    ])
    .default("Inter"),
  showPageNumbers: z.boolean().default(true),
  /** "pageOfTotal" → "Page 1 of 3"; "page" → "Page 1". */
  pageNumberFormat: z.enum(["pageOfTotal", "page"]).default("pageOfTotal"),
  showRegistrationLine: z.boolean().default(true)
});

/** Document types that support a customizable template. Widen as docs ship. */
export const documentTemplateTypeSchema = z.enum([
  "salesInvoice",
  "salesOrder",
  "purchaseOrder",
  "quote",
  "packingSlip",
  "stockTransfer",
  "jobTraveler",
  "issue",
  "trackingLabel"
]);

/**
 * Schema version of the stored template JSON. Bump when the block/theme shape
 * changes in a non-additive way; `resolveTemplate` migrates older versions
 * forward on read. (Idea borrowed from Bindery's `formatVersion`.)
 */
export const CURRENT_TEMPLATE_FORMAT_VERSION = 1;

export const documentTemplateSchema = z.object({
  formatVersion: z.number().int().default(CURRENT_TEMPLATE_FORMAT_VERSION),
  documentType: documentTemplateTypeSchema,
  blocks: z.array(blockSchema),
  theme: themeSchema.default(DEFAULT_THEME),
  settings: documentSettingsSchema.default(DEFAULT_DOCUMENT_SETTINGS),
  /** Shared sections used as the repeating page header/footer (or none). */
  headerSectionId: z.string().nullable().default(null),
  footerSectionId: z.string().nullable().default(null)
});

export type DocumentBlock = z.infer<typeof blockSchema>;
export type DocumentBlockType = DocumentBlock["type"];
export type SharedBlock = Extract<DocumentBlock, { type: "shared" }>;
export type DocumentSection = z.infer<typeof documentSectionSchema>;
export type DocumentSectionPlacement = z.infer<
  typeof documentSectionPlacementSchema
>;
/** A section row resolved for rendering (id + name + content + layout config). */
export interface ResolvedSection {
  id: string;
  name: string;
  placement: DocumentSectionPlacement;
  content: JSONContent;
  /** Header layout config (logo, which fields show). Header sections only. */
  config?: SectionConfig;
  /** True for code-provided system sections — shown read-only in the library. */
  builtIn?: boolean;
}
export type DocumentTheme = z.infer<typeof themeSchema>;
export type DocumentSettings = z.infer<typeof documentSettingsSchema>;
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;
export type DocumentTemplateType = z.infer<typeof documentTemplateTypeSchema>;

/** Narrowing helpers for the extension blocks (used by editor + renderers). */
export type RichTextBlock = Extract<DocumentBlock, { type: "richText" }>;
export type KeyValueBlock = Extract<DocumentBlock, { type: "keyValue" }>;
export type SpacerBlock = Extract<DocumentBlock, { type: "spacer" }>;
export type TermsBlock = Extract<DocumentBlock, { type: "terms" }>;
export type HeaderBlock = Extract<DocumentBlock, { type: "header" }>;
export type HeaderOptions = z.infer<typeof headerOptionsSchema>;
export type SectionConfig = z.infer<typeof sectionConfigSchema>;
export type LineItemsBlock = Extract<DocumentBlock, { type: "lineItems" }>;
export type LineItemsOptions = z.infer<typeof lineItemsOptionsSchema>;
export type SummaryBlock = Extract<DocumentBlock, { type: "summary" }>;
export type SummaryOptions = z.infer<typeof summaryOptionsSchema>;
export type CustomFieldBlock = Extract<DocumentBlock, { type: "customField" }>;
export type JobDetailsBlock = Extract<DocumentBlock, { type: "jobDetails" }>;
export type OperationsBlock = Extract<DocumentBlock, { type: "operations" }>;
export type IssueDetailsBlock = Extract<
  DocumentBlock,
  { type: "issueDetails" }
>;
export type AssociationsBlock = Extract<
  DocumentBlock,
  { type: "associations" }
>;
export type ActionTasksBlock = Extract<DocumentBlock, { type: "actionTasks" }>;
export type ReviewersBlock = Extract<DocumentBlock, { type: "reviewers" }>;
export type LabelHeadingBlock = Extract<
  DocumentBlock,
  { type: "labelHeading" }
>;
export type LabelQrCodeBlock = Extract<DocumentBlock, { type: "labelQrCode" }>;
