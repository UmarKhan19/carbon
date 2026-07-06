import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchUnitsToBom } from "./match-units";

const candidate = {
  nodeId: "pcb",
  name: "PCB Assembly",
  leafCount: 300,
  sampleParts: ["C1", "R4", "U2"]
};
const bom = [{ itemId: "i7", name: "PCB Assembly" }];

describe("matchUnitsToBom guards", () => {
  const original = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it("returns [] with no candidates", async () => {
    expect(await matchUnitsToBom([], bom)).toEqual([]);
  });

  it("returns [] with an empty BOM", async () => {
    expect(await matchUnitsToBom([candidate], [])).toEqual([]);
  });

  it("returns [] (no throw) when the OpenAI key is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await matchUnitsToBom([candidate], bom)).toEqual([]);
  });
});
