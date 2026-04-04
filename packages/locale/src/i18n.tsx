import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  I18nextProvider,
  useTranslation as useReactI18nextTranslation
} from "react-i18next";
import { initReactI18next } from "react-i18next/initReactI18next";
import { defaultLanguage, resolveLanguage, supportedLanguages } from "./config";
import enSales from "./translations/en/sales";
import enShared from "./translations/en/shared";
import plSales from "./translations/pl/sales";
import plShared from "./translations/pl/shared";

const resources = {
  en: {
    shared: enShared,
    sales: enSales
  },
  pl: {
    shared: plShared,
    sales: plSales
  }
} as const;

const namespaces = ["shared", "sales"] as const;
type Namespace = (typeof namespaces)[number];

export function LocaleProvider({
  locale,
  children
}: {
  locale?: string | null;
  children: ReactNode;
}) {
  const language = resolveLanguage(locale);

  const i18n = useMemo(() => {
    const instance = createInstance();
    instance.use(initReactI18next).init({
      lng: language,
      fallbackLng: defaultLanguage,
      supportedLngs: supportedLanguages,
      resources,
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
  }, [language]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export const useTranslation = (namespace: Namespace = "shared") =>
  useReactI18nextTranslation(namespace);
