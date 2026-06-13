import macrosPlugin from "vite-plugin-babel-macros";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Service/module code authors translatable error messages with the Lingui
  // `msg` macro (via `@carbon/result` and module `*.errors.ts`); the babel-macros
  // transform compiles those to plain descriptors under Vitest.
  plugins: [macrosPlugin()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "test/**/*.test.ts"],
    passWithNoTests: true
  }
});
