import { describe, expect, it } from "vitest";
import { unwrapArgsEnvelope } from "./args-envelope";

// The published MCP instructions taught `arguments: { args: {...} }`, which only
// operations declaring an `args` object can take — for every other one the
// envelope IS the payload, so each declared field arrived undefined and
// validation rejected the call. The unwrap runs before validation, so it has to
// be exact about which bodies it rewrites.
//
// Note the asymmetry (see .claude/rules/mcp-tools-reference.md): the opposite
// compatibility path — a flat body sent to a WRAPPED schema — lives in
// `jsonSchemaInput` and applies only when the wrapper is the sole required
// property. Nothing here should widen that.

const flatSchema = {
  type: "object",
  properties: {
    jobOperationIds: { type: "array" },
    locationId: { type: "string" }
  }
};
const wrapperSchema = {
  type: "object",
  properties: { args: { type: "object" } }
};

describe("unwrapArgsEnvelope", () => {
  it("unwraps a lone envelope for a flat-schema operation", () => {
    expect(
      unwrapArgsEnvelope(
        { schema: flatSchema },
        { args: { jobOperationIds: ["jo_1"], locationId: "loc_1" } }
      )
    ).toEqual({ jobOperationIds: ["jo_1"], locationId: "loc_1" });
  });

  it("leaves a flat body alone", () => {
    const body = { jobOperationIds: ["jo_1"], locationId: "loc_1" };
    expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
  });

  it("leaves the envelope in place when the operation declares args", () => {
    const body = { args: { limit: 10 } };
    expect(unwrapArgsEnvelope({ schema: wrapperSchema }, body)).toBe(body);
  });

  it("does not unwrap when args sits beside another key", () => {
    // Sibling keys mean the caller addressed real parameters; the dispatcher's
    // own `args` handling owns that shape.
    const body = { args: { limit: 10 }, jobId: "job_1" };
    expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
  });

  it("does not unwrap a non-object envelope", () => {
    for (const value of [null, ["jo_1"], "jobId"]) {
      const body = { args: value } as Record<string, unknown>;
      expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
    }
  });

  it("passes undefined through", () => {
    expect(
      unwrapArgsEnvelope({ schema: flatSchema }, undefined)
    ).toBeUndefined();
  });
});
