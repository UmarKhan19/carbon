import { defineConfig } from "@lingui/cli";

const commonExcludes = ["**/*.server.*", "**/*.test.*", "**/*.spec.*"];

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "pl"],
  compileNamespace: "es",
  format: "po",
  catalogs: [
    {
      path: "<rootDir>/app/locales/{locale}/shared",
      include: [
        "app/components",
        "app/hooks",
        "app/root.tsx",
        "app/routes",
        "app/modules/shared"
      ],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/account",
      include: ["app/modules/account"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/accounting",
      include: ["app/modules/accounting"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/documents",
      include: ["app/modules/documents"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/inventory",
      include: ["app/modules/inventory"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/invoicing",
      include: ["app/modules/invoicing"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/items",
      include: ["app/modules/items"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/people",
      include: ["app/modules/people"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/production",
      include: ["app/modules/production"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/purchasing",
      include: ["app/modules/purchasing"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/quality",
      include: ["app/modules/quality"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/resources",
      include: ["app/modules/resources"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/sales",
      include: ["app/modules/sales"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/settings",
      include: ["app/modules/settings"],
      exclude: commonExcludes
    },
    {
      path: "<rootDir>/app/locales/{locale}/users",
      include: ["app/modules/users"],
      exclude: commonExcludes
    }
  ]
});
