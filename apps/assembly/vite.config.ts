import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ isSsrBuild, mode }) => ({
  build: {
    minify: true,
    sourcemap: mode === "development" ? "inline" : false,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === "SOURCEMAP_ERROR") {
          return;
        }

        defaultHandler(warning);
      },
      ...(isSsrBuild && { input: "./server/app.ts" }),
    },
  },
  define: {
    global: "globalThis",
  },
  ssr: {
    noExternal: [
      "react-dropzone",
      "react-icons",
      "tailwind-merge",
      "three",
    ],
  },
  server: {
    port: 3002,
    allowedHosts: [".ngrok-free.app"],
  },
  plugins: [reactRouter(), tsconfigPaths()] as PluginOption[],
  resolve: {
    alias: {
      "@carbon/utils": path.resolve(
        __dirname,
        "../../packages/utils/src/index.ts"
      ),
      "@carbon/form": path.resolve(
        __dirname,
        "../../packages/form/src/index.tsx"
      ),
    },
  },
}));
