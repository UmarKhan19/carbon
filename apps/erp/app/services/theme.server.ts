import { DOMAIN, getCookieDomain } from "@carbon/auth";
import { resolveTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

/**
 * Read the persisted theme from the cookie, normalizing legacy/aliased names
 * (e.g. "blue" → "cobalt") and falling back to the default when absent/unknown.
 */
export function getTheme(request: Request): string {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[cookieName]
    : undefined;
  return resolveTheme(parsed)?.name ?? "zinc";
}

export function setTheme(theme: string) {
  const cookieDomain = getCookieDomain(DOMAIN);
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: 31536000
  };

  return cookie.serialize(cookieName, theme, cookieOptions);
}
