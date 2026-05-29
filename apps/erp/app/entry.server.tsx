import { getAuthSession } from "@carbon/auth/session.server";
import { postInternalAlert } from "@carbon/lib/alerts.server";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";

export const streamTimeout = 60_000;

export async function handleError(
  error: unknown,
  { request }: { request: Request }
) {
  if (request.signal.aborted) return;
  const url = new URL(request.url);

  let userId: string | undefined;
  let companyId: string | undefined;
  try {
    const session = await getAuthSession(request);
    userId = session?.userId;
    companyId = session?.companyId;
  } catch {
    // session read failures must not block alerting
  }

  void postInternalAlert({
    source: `api:${url.pathname}`,
    error,
    context: {
      method: request.method,
      url: request.url,
      userId,
      companyId
    }
  });
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext // Vercel's handler still expecting AppLoadContext type
  );
}
