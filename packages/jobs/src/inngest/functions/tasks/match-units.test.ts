import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignPartsToBom } from "./match-units";

const parts = [
  { name: "R_0402_1005Metric_49", count: 40 },
  { name: "minimalBCU_gen2_PCB", count: 1 }
];
const bom = [{ itemId: "i_pcb", name: "BCU PCB" }];

describe("assignPartsToBom guards", () => {
  const original = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it("returns [] with no parts", async () => {
    expect(await assignPartsToBom([], bom)).toEqual([]);
  });

  it("returns [] with an empty BOM", async () => {
    expect(await assignPartsToBom(parts, [])).toEqual([]);
  });

  it("returns [] when the part set is implausibly large", async () => {
    const many = Array.from({ length: 601 }, (_, i) => ({
      name: `P${i}`,
      count: 1
    }));
    expect(await assignPartsToBom(many, bom)).toEqual([]);
  });

  it("returns [] (no throw) when the OpenAI key is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await assignPartsToBom(parts, bom)).toEqual([]);
  });
});
