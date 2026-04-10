import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "de", "it", "ja", "zh"],
  format: "po",
  catalogs: [
    {
      path: "packages/locale/locales/{locale}/erp",
      include: ["apps/erp/app"],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    }
  ]
});
