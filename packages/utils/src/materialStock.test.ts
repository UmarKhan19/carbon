import {
  buildStockDimensions,
  isStockCompatible
} from "./materialStock";

describe("materialStock", () => {
  it("maps sheet dimensions as length/width", () => {
    const stock = buildStockDimensions({
      type: "sheet",
      length: 120,
      width: 48
    });

    expect(stock.type).toBe("sheet");
    expect(stock.length).toBe(120);
    expect(stock.width).toBe(48);
    expect(stock.originalLength).toBe(120);
    expect(stock.originalWidth).toBe(48);
  });

  it("keeps roll as length/width with unit height", () => {
    const stock = buildStockDimensions({
      type: "roll",
      length: 500,
      width: 24
    });

    expect(stock.type).toBe("roll");
    expect(stock.length).toBe(500);
    expect(stock.width).toBe(24);
    expect(stock.height).toBe(1);
  });

  it("applies block-only height compatibility checks", () => {
    const block = buildStockDimensions({
      type: "block",
      length: 20,
      width: 10,
      height: 5
    });
    const sheet = buildStockDimensions({
      type: "sheet",
      length: 20,
      width: 10
    });

    expect(isStockCompatible(block, { length: 10, width: 8, height: 2 })).toBe(
      true
    );
    expect(isStockCompatible(sheet, { length: 10, width: 8, height: 2 })).toBe(
      false
    );
  });
});
