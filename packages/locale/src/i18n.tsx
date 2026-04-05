import { type I18n as LinguiI18n, setupI18n } from "@lingui/core";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo
} from "react";
import { resolveLanguage, type SupportedLanguage } from "./config";

export const namespaces = ["shared", "sales"] as const;
export type Namespace = (typeof namespaces)[number];

type TranslationModule = {
  default: Record<string, string>;
};

type NamespaceResources = Partial<Record<Namespace, Record<string, string>>>;
export type LocaleResources = Partial<
  Record<SupportedLanguage, NamespaceResources>
>;

type TranslationOptions = Record<string, unknown> & {
  defaultValue?: string;
  ns?: Namespace;
};

type TranslationApi = {
  language: SupportedLanguage;
  resolvedLanguage: SupportedLanguage;
  t: (key: string, options?: TranslationOptions) => string;
};

type TranslationResult = {
  t: (key: string, options?: TranslationOptions) => string;
  i18n: TranslationApi;
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

const MESSAGE_ID_SEPARATOR = "::";

const getMessageId = (namespace: Namespace, key: string) =>
  `${namespace}${MESSAGE_ID_SEPARATOR}${key}`;

const normalizeInterpolation = (value: string) => {
  return value.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, "{$1}");
};

const interpolateFallback = (
  template: string,
  values: Record<string, unknown>
) => {
  if (Object.keys(values).length === 0) return template;

  return template.replace(
    /\{\{\s*([^{}\s]+)\s*\}\}|\{([^{}\s]+)\}/g,
    (match, legacyToken, linguiToken) => {
      const token = (legacyToken ?? linguiToken) as string;
      const replacement = values[token];
      if (replacement === null || replacement === undefined) return match;
      return String(replacement);
    }
  );
};

const toMessageCatalog = (
  namespace: Namespace,
  resource: Record<string, string>
) => {
  const entries = Object.entries(resource).flatMap(([key, value]) => {
    const normalizedKey = normalizeInterpolation(key);
    const normalizedValue = normalizeInterpolation(value);
    const keyEntries = [
      [getMessageId(namespace, key), normalizedValue],
      [key, normalizedValue]
    ] as Array<readonly [string, string]>;

    if (normalizedKey !== key) {
      keyEntries.push([
        getMessageId(namespace, normalizedKey),
        normalizedValue
      ]);
      keyEntries.push([normalizedKey, normalizedValue]);
    }

    return keyEntries;
  });

  return Object.fromEntries(entries) as Record<string, string>;
};

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

type LocaleRuntime = {
  catalogs: Record<string, string>;
  i18n: LinguiI18n;
  language: SupportedLanguage;
  loadedNamespaces: Set<Namespace>;
};

type LocaleRuntimeContextValue = {
  ensureNamespace: (namespace: Namespace) => Promise<void>;
  runtime: LocaleRuntime;
};

const LocaleRuntimeContext = createContext<LocaleRuntimeContextValue | null>(
  null
);

const getInitialRuntime = (
  language: SupportedLanguage,
  resources: LocaleResources | undefined,
  catalog: Record<string, string> | undefined
): LocaleRuntime => {
  const i18n = setupI18n();
  const loadedNamespaces = new Set<Namespace>();
  const catalogs: Record<string, string> = {
    ...(catalog ?? {})
  };
  const languageResources = resources?.[language];

  for (const namespace of namespaces) {
    const resource = languageResources?.[namespace];
    if (!resource) continue;
    loadedNamespaces.add(namespace);
    Object.assign(catalogs, toMessageCatalog(namespace, resource));
  }

  i18n.load(language, catalogs);
  i18n.activate(language);

  return {
    catalogs,
    i18n,
    language,
    loadedNamespaces
  };
};

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
  } as LocaleResources;
}

export function LocaleProvider({
  locale,
  resources,
  catalog,
  children
}: {
  locale?: string | null;
  resources?: LocaleResources;
  catalog?: Record<string, string>;
  children: ReactNode;
}) {
  const language = resolveLanguage(locale);
  const runtime = useMemo(() => {
    return getInitialRuntime(language, resources, catalog);
  }, [catalog, language, resources]);

  const ensureNamespace = useMemo(() => {
    return async (namespace: Namespace) => {
      if (runtime.loadedNamespaces.has(namespace)) return;

      const resource = await loadNamespaceResource(language, namespace);
      if (runtime.loadedNamespaces.has(namespace)) return;

      runtime.loadedNamespaces.add(namespace);
      Object.assign(runtime.catalogs, toMessageCatalog(namespace, resource));
      runtime.i18n.load(language, runtime.catalogs);
      runtime.i18n.activate(language);
    };
  }, [language, runtime]);

  return (
    <LocaleRuntimeContext.Provider value={{ ensureNamespace, runtime }}>
      <LinguiProvider i18n={runtime.i18n}>{children}</LinguiProvider>
    </LocaleRuntimeContext.Provider>
  );
}

const useLocaleRuntime = () => {
  const localeRuntime = useContext(LocaleRuntimeContext);
  if (!localeRuntime) {
    throw new Error("useTranslation must be used within LocaleProvider");
  }
  return localeRuntime;
};

export const useTranslation = (
  namespace: Namespace = "shared"
): TranslationResult => {
  const { ensureNamespace, runtime } = useLocaleRuntime();

  useEffect(() => {
    void ensureNamespace(namespace);
  }, [ensureNamespace, namespace]);

  const translate = useMemo(() => {
    return (key: string, options?: TranslationOptions) => {
      const { defaultValue, ns, ...values } = options ?? {};
      const targetNamespace = ns ?? namespace;
      const messageId = getMessageId(targetNamespace, key);
      const translated = runtime.i18n._(messageId, values);
      if (!translated || translated === messageId) {
        return interpolateFallback(defaultValue ?? key, values);
      }
      return translated;
    };
  }, [namespace, runtime.i18n]);

  const i18n = useMemo<TranslationApi>(() => {
    return {
      language: runtime.language,
      resolvedLanguage: runtime.language,
      t: (key: string, options?: TranslationOptions) => translate(key, options)
    };
  }, [runtime.language, translate]);

  return {
    t: translate,
    i18n
  };
};
