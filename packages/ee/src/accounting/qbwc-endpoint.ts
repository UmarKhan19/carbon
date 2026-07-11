/**
 * Dedicated subpath export (`@carbon/ee/accounting/qbwc`) for the ERP SOAP
 * resource route (`apps/erp/app/routes/api+/integrations.quickbooks-desktop.qbwc.ts`).
 *
 * The QBWC protocol internals (qbwc/handler.ts, qbwc/soap.ts and the
 * session machinery they drive) deliberately stay OUT of the ./accounting
 * barrel — see the note in providers/quickbooks-desktop/index.ts. The D7
 * guidance ("the SOAP resource route imports them by file path") predates
 * the exports-map check: `@carbon/ee`'s package.json `exports` field
 * forbids deep file imports from apps, so this module is the sanctioned
 * doorway instead. It re-exports exactly what the HTTP endpoint needs and
 * nothing else — the rest of the protocol surface remains internal.
 */
export {
  handleQbwcRequest,
  type QbwcHandlerContext
} from "./providers/quickbooks-desktop/qbwc/handler";
export { buildQbwcSoapFault } from "./providers/quickbooks-desktop/qbwc/soap";
