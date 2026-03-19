import type { AvalaraProvider } from "./avalara/provider";
import type { TaxJarProvider } from "./taxjar/provider";

export type TaxProvider = AvalaraProvider | TaxJarProvider;

export { AvalaraProvider } from "./avalara/provider";
export { TaxJarProvider } from "./taxjar/provider";
