import macrosPlugin from "vite-plugin-babel-macros";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@carbon/config/vitest";

// The core error classes author their default messages with the Lingui `msg`
// macro (`@lingui/core/macro`). That macro only resolves to a plain
// MessageDescriptor once the babel-macros transform has run. The apps get this
// transform from `vite-plugin-babel-macros` in their Vite config; tests for this
// package need the same plugin so `msg` compiles away under Vitest.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [macrosPlugin()],
    test: {
      // Let the `demo` script print its translation table straight to stdout.
      disableConsoleIntercept: true
    }
  })
);
