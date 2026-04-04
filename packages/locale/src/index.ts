export type { SupportedLanguage } from "./config";
export {
  defaultLanguage,
  localeCookieName,
  resolveLanguage,
  supportedLanguages
} from "./config";
export type { Namespace } from "./i18n";
export {
  LocaleProvider,
  loadLocaleResources,
  namespaces,
  useTranslation
} from "./i18n";
