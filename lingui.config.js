import { defineConfig } from "@lingui/cli";

const commonExcludes = ["**/*.server.*", "**/*.test.*", "**/*.spec.*"];

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "fr", "de", "es", "it", "ja", "pl", "pt", "ru", "zh"],
  format: "po",
  catalogs: [
    {
      path: "packages/locale/locales/{locale}/shared",
      include: [
        "apps/erp/app/components",
        "apps/erp/app/hooks",
        "apps/erp/app/root.tsx",
        "apps/erp/app/routes",
        "apps/erp/app/modules/shared"
      ],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/account",
      include: ["apps/erp/app/modules/account"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/accounting",
      include: ["apps/erp/app/modules/accounting"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/documents",
      include: ["apps/erp/app/modules/documents"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/inventory",
      include: ["apps/erp/app/modules/inventory"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/invoicing",
      include: ["apps/erp/app/modules/invoicing"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/items",
      include: ["apps/erp/app/modules/items"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/people",
      include: ["apps/erp/app/modules/people"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/production",
      include: ["apps/erp/app/modules/production"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/purchasing",
      include: ["apps/erp/app/modules/purchasing"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/quality",
      include: ["apps/erp/app/modules/quality"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/resources",
      include: ["apps/erp/app/modules/resources"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/sales",
      include: ["apps/erp/app/modules/sales"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/settings",
      include: ["apps/erp/app/modules/settings"],
      exclude: commonExcludes
    },
    {
      path: "packages/locale/locales/{locale}/users",
      include: ["apps/erp/app/modules/users"],
      exclude: commonExcludes
    }
  ]
});
