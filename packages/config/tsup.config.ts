import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["vitest.mts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  external: ["vitest", "vitest/config"],
});
