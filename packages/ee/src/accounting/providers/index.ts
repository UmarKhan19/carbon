import type { QboProvider } from "./quickbooks-online";
import type { XeroProvider } from "./xero";

export type AccountingProvider = XeroProvider | QboProvider;

export * from "./quickbooks-online";
export * from "./xero";
