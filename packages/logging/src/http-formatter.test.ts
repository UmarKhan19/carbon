import { describe, expect, it } from "vitest";
import { httpDevFormatter } from "./http-formatter";

function record(properties: Record<string, unknown>) {
  return {
    category: ["carbon", "http"],
    level: "debug",
    message: ["access log"],
    rawMessage: "access log",
    timestamp: Date.now(),
    properties
  } as never;
}

describe("httpDevFormatter", () => {
  it("keeps the standard timestamp/level/category prefix", () => {
    const line = httpDevFormatter(
      record({ method: "GET", pathname: "/dashboard", status: 200 })
    );
    expect(line).toContain("DBG");
    expect(line).toContain("carbon·http");
  });

  it("renders the message portion as a morgan dev-style access line", () => {
    const line = httpDevFormatter(
      record({
        method: "GET",
        pathname: "/dashboard",
        status: 200,
        responseTime: 12.34
      })
    );
    expect(line).toContain("GET /dashboard \x1b[32m200\x1b[0m 12.3 ms");
  });

  it("colors 3xx cyan, 4xx yellow, 5xx red", () => {
    expect(
      httpDevFormatter(record({ method: "GET", pathname: "/x", status: 301 }))
    ).toContain("\x1b[36m301\x1b[0m");
    expect(
      httpDevFormatter(record({ method: "GET", pathname: "/x", status: 404 }))
    ).toContain("\x1b[33m404\x1b[0m");
    expect(
      httpDevFormatter(record({ method: "POST", pathname: "/x", status: 500 }))
    ).toContain("\x1b[31m500\x1b[0m");
  });

  it("truncates rather than rounds, and drops a padded trailing zero", () => {
    // 12.36 rounds to 12.4 but truncates to 12.3 — must match truncation.
    expect(
      httpDevFormatter(
        record({
          method: "GET",
          pathname: "/x",
          status: 200,
          responseTime: 12.36
        })
      )
    ).toContain("GET /x \x1b[32m200\x1b[0m 12.3 ms");
    // Exact integer ms — no forced ".0".
    expect(
      httpDevFormatter(
        record({ method: "GET", pathname: "/x", status: 200, responseTime: 5 })
      )
    ).toContain("GET /x \x1b[32m200\x1b[0m 5 ms");
  });

  it("omits response time when absent", () => {
    const line = httpDevFormatter(
      record({ method: "GET", pathname: "/x", status: 200 })
    );
    expect(line).toContain("GET /x \x1b[32m200\x1b[0m");
    expect(line).not.toContain("ms");
  });

  it("falls back to the default rendered message for non-access-log records", () => {
    const line = httpDevFormatter(record({ note: "not an access log" }));
    expect(line).toContain("access log");
  });
});
