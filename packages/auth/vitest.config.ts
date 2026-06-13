import macrosPlugin from "vite-plugin-babel-macros";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@carbon/config/vitest";

// The boundary converter tests construct core errors from `@carbon/result`,
// whose default messages use the Lingui `msg` macro. Register the babel-macros
// transform so that macro compiles to a plain descriptor under Vitest.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [macrosPlugin()]
  })
);
