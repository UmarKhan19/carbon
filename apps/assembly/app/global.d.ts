import type { QueryClient } from "@tanstack/react-query";

declare global {
  interface Window {
    env: Record<string, string>;
    clientCache?: QueryClient;
  }
}
