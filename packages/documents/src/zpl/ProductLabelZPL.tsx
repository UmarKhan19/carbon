import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { getZplLabelGeometry, zplLabelHeader } from "./utils";

export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize
): string {
  const geometry = getZplLabelGeometry(labelSize);
  const { widthDots, heightDots, hScale, scale, margin } = geometry;

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

  let zpl = zplLabelHeader(geometry);

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
