import { createHmac, timingSafeEqual } from "node:crypto";
import { Edition } from "@carbon/utils";
import * as cookie from "cookie";
import { getCookieDomain } from "../utils/cookie";

const CONSOLE_PIN_PREFIX = "console-pin-";
const CONSOLE_PIN_MAX_AGE = 60 * 60;
const CONSOLE_PIN_MAX_AGE_MS = CONSOLE_PIN_MAX_AGE * 1000;
const sessionSecret = process.env.SESSION_SECRET;
const isTestEdition = process.env.CARBON_EDITION === Edition.Test;
const cookieDomain = isTestEdition
  ? undefined
  : getCookieDomain(process.env.DOMAIN);

export interface ConsolePinIn {
  userId: string;
  name: string;
  avatarUrl: string | null;
  pinnedAt: number;
}

function getConsolePinCookieName(companyId: string) {
  return `${CONSOLE_PIN_PREFIX}${companyId}`;
}

function signConsolePin(encodedPayload: string) {
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not set");
  }

  return createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");
}

function getConsolePinCookieOptions(maxAge: number) {
  return {
    path: "/",
    maxAge,
    httpOnly: true,
    sameSite: isTestEdition ? ("none" as const) : ("lax" as const),
    secure: process.env.VERCEL_ENV === "production",
    domain: process.env.VERCEL_ENV === "production" ? cookieDomain : undefined
  };
}

function parseConsolePinCookie(raw: string): ConsolePinIn | null {
  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signConsolePin(encodedPayload);

  try {
    if (
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }

    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as ConsolePinIn;
    const elapsed = Date.now() - parsed.pinnedAt;

    if (elapsed > CONSOLE_PIN_MAX_AGE_MS) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function getConsolePinIn(
  request: Request,
  companyId: string
): ConsolePinIn | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const raw = cookie.parse(cookieHeader)[getConsolePinCookieName(companyId)];
  if (!raw) return null;

  return parseConsolePinCookie(raw);
}

export async function getValidatedConsolePinIn(
  request: Request,
  companyId: string
): Promise<ConsolePinIn | null> {
  const pinIn = getConsolePinIn(request, companyId);
  if (!pinIn) return null;

  const { getCarbonServiceRole } = await import(
    "../lib/supabase/client.server"
  );

  const employee = await getCarbonServiceRole()
    .from("employee")
    .select("id")
    .eq("id", pinIn.userId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (employee.error || !employee.data) return null;

  return pinIn;
}

export function setConsolePinIn(companyId: string, data: ConsolePinIn): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const value = `${payload}.${signConsolePin(payload)}`;

  return cookie.serialize(
    getConsolePinCookieName(companyId),
    value,
    getConsolePinCookieOptions(CONSOLE_PIN_MAX_AGE)
  );
}

export function clearConsolePinIn(companyId: string): string {
  return cookie.serialize(
    getConsolePinCookieName(companyId),
    "",
    getConsolePinCookieOptions(0)
  );
}

export function refreshConsolePinIn(
  companyId: string,
  existing: ConsolePinIn
): string {
  return setConsolePinIn(companyId, {
    ...existing,
    pinnedAt: Date.now()
  });
}
