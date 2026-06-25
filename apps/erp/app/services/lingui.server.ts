import { resolveLanguage } from "@carbon/locale";
import { getPreferenceHeaders } from "@carbon/utils";
import { type I18n, type Messages, setupI18n } from "@lingui/core";

const catalogLoaders = import.meta.glob(
  "../../../../packages/locale/locales/*/erp.mjs",
  {
    import: "messages"
  }
) as Record<string, () => Promise<Messages>>;

export async function loadLinguiCatalogForRequest(
  _request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const catalogPath = `../../../../packages/locale/locales/${language}/erp.mjs`;
  const load = catalogLoaders[catalogPath];
  return load ? load() : {};
}

/**
 * Builds an activated, request-scoped i18n instance for the requester's locale.
 * Used at the action boundary by `error`/`success` to translate error
 * messages at write time. Server-only — never activates the global singleton.
 */
export async function getRequestI18n(request: Request): Promise<I18n> {
  const { locale } = getPreferenceHeaders(request);
  const language = resolveLanguage(locale);
  const messages = (await loadLinguiCatalogForRequest(
    request,
    language
  )) as Messages;

  const i18n = setupI18n();
  i18n.load(language, messages);
  i18n.activate(language);
  return i18n;
}
