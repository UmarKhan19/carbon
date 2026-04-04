import type { Resource } from "i18next";
import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  I18nextProvider,
  useTranslation as useReactI18nextTranslation
} from "react-i18next";
import { initReactI18next } from "react-i18next/initReactI18next";
import {
  defaultLanguage,
  resolveLanguage,
  type SupportedLanguage,
  supportedLanguages
} from "./config";

export const namespaces = ["shared", "sales"] as const;
export type Namespace = (typeof namespaces)[number];

type TranslationModule = {
  default: Record<string, string>;
};

const translationLoaders: Record<
  SupportedLanguage,
  Record<Namespace, () => Promise<TranslationModule>>
> = {
  en: {
    shared: () => import("./translations/en/shared"),
    sales: () => import("./translations/en/sales")
  },
  pl: {
    shared: () => import("./translations/pl/shared"),
    sales: () => import("./translations/pl/sales")
  }
};

export async function loadLocaleResources(
  locale: string | null | undefined,
  targetNamespaces: readonly Namespace[] = namespaces
) {
  const language = resolveLanguage(locale);
  const languageLoaders = translationLoaders[language];

  const loadedNamespaces = await Promise.all(
    targetNamespaces.map(async (namespace) => {
      const module = await languageLoaders[namespace]();
      return [namespace, module.default] as const;
    })
  );

  return {
    [language]: Object.fromEntries(loadedNamespaces)
  } as Resource;
}

export function LocaleProvider({
  locale,
  resources,
  children
}: {
  locale?: string | null;
  resources?: Resource;
  children: ReactNode;
}) {
  const language = resolveLanguage(locale);

  const i18n = useMemo(() => {
    const instance = createInstance();
    instance.use(initReactI18next).init({
      lng: language,
      fallbackLng: defaultLanguage,
      supportedLngs: supportedLanguages,
      resources: resources ?? {},
      ns: namespaces as unknown as string[],
      defaultNS: "shared",
      fallbackNS: "shared",
      interpolation: {
        escapeValue: false
      },
      keySeparator: false,
      nsSeparator: false,
      returnEmptyString: false,
      react: {
        useSuspense: false
      }
    });

    return instance;
  }, [language, resources]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export const useTranslation = (namespace: Namespace = "shared") =>
  useReactI18nextTranslation(namespace);
