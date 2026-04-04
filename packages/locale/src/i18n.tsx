import type { Resource } from "i18next";
import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
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

const namespaceResourceCache = new Map<
  string,
  Promise<Record<string, string>>
>();

function loadNamespaceResource(
  language: SupportedLanguage,
  namespace: Namespace
) {
  const cacheKey = `${language}:${namespace}`;
  const cachedResource = namespaceResourceCache.get(cacheKey);
  if (cachedResource) return cachedResource;

  const resourcePromise = translationLoaders[language]
    [namespace]()
    .then((module) => module.default);
  namespaceResourceCache.set(cacheKey, resourcePromise);
  return resourcePromise;
}

export async function loadLocaleResources(
  locale: string | null | undefined,
  targetNamespaces: readonly Namespace[] = namespaces
) {
  const language = resolveLanguage(locale);

  const loadedNamespaces = await Promise.all(
    targetNamespaces.map(async (namespace) => {
      const resource = await loadNamespaceResource(language, namespace);
      return [namespace, resource] as const;
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

export const useTranslation = (namespace: Namespace = "shared") => {
  const translation = useReactI18nextTranslation(namespace);
  const { i18n } = translation;

  useEffect(() => {
    let isActive = true;
    const language = resolveLanguage(i18n.resolvedLanguage ?? i18n.language);

    if (i18n.hasResourceBundle(language, namespace)) return;

    loadNamespaceResource(language, namespace).then((resource) => {
      if (!isActive) return;
      if (!i18n.hasResourceBundle(language, namespace)) {
        i18n.addResourceBundle(language, namespace, resource, true, true);
      }
      void i18n.loadNamespaces(namespace);
    });

    return () => {
      isActive = false;
    };
  }, [i18n, i18n.language, i18n.resolvedLanguage, namespace]);

  return translation;
};
