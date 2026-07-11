import type { QbdProvider } from "./quickbooks-desktop";
import type { QboProvider } from "./quickbooks-online";
import type { XeroProvider } from "./xero";

export type AccountingProvider = XeroProvider | QboProvider | QbdProvider;

export * from "./quickbooks-desktop";
export * from "./quickbooks-online";
export * from "./xero";
