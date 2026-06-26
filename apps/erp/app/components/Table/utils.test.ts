import { describe, expect, it } from "vitest";
import { getCellClipClassName } from "./utils";

describe("getCellClipClassName", () => {
  it("clips to a single line by default", () => {
    const className = getCellClipClassName();
    expect(className).toContain("truncate");
    expect(className).toContain("whitespace-nowrap");
  });

  it("opts out of truncation when a column provides cellClassName", () => {
    // The Documents labels column passes "whitespace-normal" so 4+ label chips
    // wrap onto multiple lines instead of overflowing and clipping the remove
    // (×) button.
    const className = getCellClipClassName("whitespace-normal");
    expect(className).toBe("whitespace-normal");
    expect(className).not.toContain("truncate");
    expect(className).not.toContain("whitespace-nowrap");
  });
});
