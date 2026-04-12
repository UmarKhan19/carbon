import { DOMAIN, getCookieDomain } from "@carbon/auth";
import { localeCookieName, resolveLanguage } from "@carbon/locale";
import * as cookie from "cookie";

export function setLocale(locale: string) {
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    maxAge: 31536000
  };

  const cookieDomain = getCookieDomain(DOMAIN);
  if (cookieDomain) cookieOptions.domain = cookieDomain;

  return cookie.serialize(
    localeCookieName,
    resolveLanguage(locale),
    cookieOptions
  );
}
