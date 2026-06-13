import { createContext, type MiddlewareFunction } from "react-router";
import { getSessionFlash } from "../services/session.server";
import type { FlashResult } from "../types";

export const flashResultContext = createContext<FlashResult | null>(null);
export const flashHeadersContext = createContext<Record<string, string> | null>(
  null
);

export const flashMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const sessionFlash = await getSessionFlash(request);
  if (sessionFlash) {
    context.set(flashResultContext, sessionFlash.result);
    context.set(flashHeadersContext, sessionFlash.headers);
  }
  return next();
};
