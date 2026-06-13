import macrosPlugin from "vite-plugin-babel-macros";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@carbon/config/vitest";

// The adapters import `@carbon/result`, whose core error classes author their
// default messages with the Lingui `msg` macro. Register the babel-macros
// transform so that macro compiles to a plain descriptor under Vitest.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [macrosPlugin()]
  })
);
