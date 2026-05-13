import { describe, expect, it } from "vitest";
import { renderEnv } from "./env.js";
import type { JwtCreds, PortMap } from "./worktree.js";

const ports: PortMap = {
  PORT_API: 54001,
  PORT_DB: 54000,
  PORT_INBUCKET: 54003,
  PORT_INNGEST: 54004,
  PORT_STUDIO: 54002
};

const jwt: JwtCreds = {
  anonKey: "test-anon-key",
  secret: "test-secret",
  serviceKey: "test-service-key"
};

describe("renderEnv", () => {
  it("emits the per-worktree slug and prefix-derived hosts", () => {
    const out = renderEnv({
      branchPrefix: "feat-x",
      jwt,
      ports,
      redisDb: 3,
      slug: "feat-x"
    });
    expect(out).toContain("CARBON_WORKTREE=feat-x");
    expect(out).toContain("ERP_URL=https://feat-x.erp.dev");
    expect(out).toContain("MES_URL=https://feat-x.mes.dev");
    expect(out).toContain("SUPABASE_URL=https://feat-x.api.dev");
  });

  it("wires every port into env vars", () => {
    const out = renderEnv({
      branchPrefix: "s",
      jwt,
      ports,
      redisDb: 0,
      slug: "s"
    });
    expect(out).toContain("PORT_DB=54000");
    expect(out).toContain("PORT_API=54001");
    expect(out).toContain("PORT_STUDIO=54002");
    expect(out).toContain("PORT_INBUCKET=54003");
    expect(out).toContain("PORT_INNGEST=54004");
  });

  it("places redis db index in REDIS_URL", () => {
    const out = renderEnv({
      branchPrefix: "s",
      jwt,
      ports,
      redisDb: 7,
      slug: "s"
    });
    expect(out).toMatch(/REDIS_URL=redis:\/\/localhost:\d+\/7/);
  });

  it("injects jwt creds verbatim", () => {
    const out = renderEnv({
      branchPrefix: "s",
      jwt,
      ports,
      redisDb: 0,
      slug: "s"
    });
    expect(out).toContain("SUPABASE_JWT_SECRET=test-secret");
    expect(out).toContain("SUPABASE_ANON_KEY=test-anon-key");
    expect(out).toContain("SUPABASE_SERVICE_ROLE_KEY=test-service-key");
  });

  it("ends with a trailing newline", () => {
    const out = renderEnv({
      branchPrefix: "s",
      jwt,
      ports,
      redisDb: 0,
      slug: "s"
    });
    expect(out.endsWith("\n")).toBe(true);
  });
});
