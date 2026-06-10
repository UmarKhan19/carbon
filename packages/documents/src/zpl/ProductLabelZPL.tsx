import type { LabelSize, ProductLabelItem } from "@carbon/utils";

export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize
): string {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;

  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  // Scale everything relative to a 2"x1" baseline (406x203 dots at 203dpi)
  const wScale = widthDots / 406;
  const hScale = heightDots / 203;
  const scale = Math.min(wScale, hScale);

  const margin = Math.round(20 * Math.max(scale, 0.8));
  const titleFont = Math.round(25 * scale);
  const descFont = Math.round(18 * scale);
  const smallFont = Math.round(12 * scale);
  const lineGap = Math.round(25 * scale);

  // QR module size scales with the smaller dimension
  const qrModuleSize = Math.max(2, Math.min(8, Math.round(4 * scale)));
  // Approximate QR pixel width: module * (21 + 2*error_correction_overhead) ≈ module * 29
  const qrPixelSize = qrModuleSize * 29;
  const qrX = widthDots - qrPixelSize - margin;
  const qrY = Math.round(30 * hScale);

  let zpl = "^XA";
  zpl += `^PW${widthDots}`;
  zpl += `^LL${heightDots}`;
  zpl += "^MNW";
  zpl += "^CI28";

  let y = Math.round(30 * hScale);

  zpl += `^FO${margin},${y}^A0N,${titleFont},${titleFont}^FD${item.itemId}^FS`;
  y += titleFont + Math.round(10 * hScale);

  if (item.revision) {
    zpl += `^FO${margin},${y}^A0N,${descFont},${descFont}^FDRev: ${item.revision}^FS`;
    y += lineGap;
  }

  if (["Serial", "Batch"].includes(item.trackingType)) {
    zpl += `^FO${margin},${y}^A0N,${descFont},${descFont}^FDQty: ${item.quantity}^FS`;
    y += lineGap;
  }

  if (item.trackingType === "Serial") {
    zpl += `^FO${margin},${y}^A0N,${descFont},${descFont}^FDS/N: ${item.number}^FS`;
  } else if (item.trackingType === "Batch") {
    zpl += `^FO${margin},${y}^A0N,${descFont},${descFont}^FDBatch: ${item.number}^FS`;
  }

  zpl += `^FO${qrX},${qrY}^BQN,2,${qrModuleSize}^FDMA,${item.trackedEntityId}^FS`;

  const idY = heightDots - smallFont - Math.round(10 * hScale);
  zpl += `^FO${margin},${idY}^A0N,${smallFont},${smallFont}^FD${item.trackedEntityId}^FS`;

  zpl += "^XZ";

  return zpl;
}
