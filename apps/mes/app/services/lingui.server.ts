import { resolveLanguage } from "@carbon/locale";
import type { Messages } from "@lingui/core";

const catalogLoaders = import.meta.glob(
  "../../../../packages/locale/locales/*/mes.mjs",
  {
    import: "messages"
  }
) as Record<string, () => Promise<Messages>>;

export async function loadLinguiCatalogForRequest(
  _request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const catalogPath = `../../../../packages/locale/locales/${language}/mes.mjs`;
  const load = catalogLoaders[catalogPath];
  return load ? load() : {};
}
