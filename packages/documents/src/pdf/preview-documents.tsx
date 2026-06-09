import type { ComponentType } from "react";
import type { DocumentTemplateType } from "../template";
import SalesInvoicePDF from "./SalesInvoicePDF";
import SalesOrderPDF from "./SalesOrderPDF";
import { SAMPLE_SALES_ORDER } from "./salesOrder.samples";
import { SAMPLE_SALES_INVOICE } from "./samples";

/**
 * Maps a document type to its PDF component + sample fixture, so the template
 * preview route can render any supported document generically. Adding a doc =
 * add an entry here (plus its enum / default template / registry).
 */
// biome-ignore lint/suspicious/noExplicitAny: each PDF has a distinct prop shape
type PreviewEntry = { Component: ComponentType<any>; sample: any };

export const DOCUMENT_PDFS: Record<DocumentTemplateType, PreviewEntry> = {
  salesInvoice: { Component: SalesInvoicePDF, sample: SAMPLE_SALES_INVOICE },
  salesOrder: { Component: SalesOrderPDF, sample: SAMPLE_SALES_ORDER }
};
