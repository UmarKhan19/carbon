import { resolveTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

export function getTheme(request: Request): string {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[cookieName]
    : undefined;
  return resolveTheme(parsed)?.name ?? "zinc";
}

export function setTheme(theme: string) {
  return cookie.serialize(cookieName, theme, { path: "/", maxAge: 31536000 });
}
