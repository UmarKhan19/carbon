import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "de", "it", "ja", "zh"],
  format: "po",
  catalogs: [
    {
      path: "packages/locale/locales/{locale}/erp",
      include: ["apps/erp/app", "packages/react/src"],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    },
    {
      path: "packages/locale/locales/{locale}/mes",
      include: ["apps/mes/app", "packages/react/src"],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    }
  ]
});
