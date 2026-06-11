import type { LabelSize } from "@carbon/utils";

export type StorageUnitLabelItem = {
  name: string;
  id: string;
};

export function generateStorageUnitLabelZPL(
  item: StorageUnitLabelItem,
  labelSize: LabelSize
): string {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;

  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  const wScale = widthDots / 406;
  const hScale = heightDots / 203;
  const scale = Math.min(wScale, hScale);

  const margin = Math.round(20 * Math.max(scale, 0.8));
  const titleFont = Math.round(40 * scale);

  const textY = Math.round((heightDots - titleFont) / 2);

  let zpl = "^XA";
  zpl += `^PW${widthDots}`;
  zpl += `^LL${heightDots}`;
  zpl += "^MNW";
  zpl += "^CI28";

  zpl += `^FO${margin},${textY}^A0N,${titleFont},${titleFont}^FD${item.name}^FS`;

  zpl += "^XZ";

  return zpl;
}
