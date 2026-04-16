import * as cookie from "cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("console pin cookie", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CARBON_EDITION", "test");
    vi.stubEnv("SESSION_SECRET", "test-secret");
    vi.stubEnv("VERCEL_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a signed console pin cookie", async () => {
    const { getConsolePinIn, setConsolePinIn } = await import(
      "./console.server"
    );

    const setCookie = setConsolePinIn("company-1", {
      userId: "employee-1",
      name: "Operator",
      avatarUrl: null,
      pinnedAt: Date.now()
    });

    const cookieValue =
      setCookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    const request = new Request("http://localhost", {
      headers: {
        cookie: cookie.serialize("console-pin-company-1", cookieValue)
      }
    });

    expect(getConsolePinIn(request, "company-1")).toMatchObject({
      userId: "employee-1",
      name: "Operator"
    });
  });

  it("rejects a tampered console pin cookie", async () => {
    const { getConsolePinIn, setConsolePinIn } = await import(
      "./console.server"
    );

    const setCookie = setConsolePinIn("company-1", {
      userId: "employee-1",
      name: "Operator",
      avatarUrl: null,
      pinnedAt: Date.now()
    });

    const value = setCookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    const [payload, signature] = value.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        userId: "employee-2",
        name: "Operator",
        avatarUrl: null,
        pinnedAt: Date.now()
      })
    ).toString("base64url");

    const request = new Request("http://localhost", {
      headers: {
        cookie: cookie.serialize(
          "console-pin-company-1",
          `${tamperedPayload}.${signature ?? payload}`
        )
      }
    });

    expect(getConsolePinIn(request, "company-1")).toBeNull();
  });
});
