import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@carbon/config/vitest";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ["src/ratelimit/**/*.ts"],
      },
    },
  })
);
