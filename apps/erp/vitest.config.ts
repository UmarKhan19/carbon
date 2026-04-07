import baseConfig from "@carbon/config/vitest";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig, mergeConfig } from "vitest/config";

// apps/erp imports via the `~/*` alias, which needs vite-tsconfig-paths
// to resolve during vitest runs.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [tsconfigPaths()]
  })
);
