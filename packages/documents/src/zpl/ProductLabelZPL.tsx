import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import type { DocumentTemplate } from "../template";
import { interpolateString, resolveTemplate } from "../template";

/** Merge-field values for a label (kept in sync with buildLabelVars). */
function labelVars(item: ProductLabelItem): Record<string, string> {
  const str = (v: unknown): string => (v == null ? "" : String(v));
  return {
    "item.id": str(item.itemId),
    "item.revision": str(item.revision),
    "label.quantity": str(item.quantity),
    "label.trackingType": str(item.trackingType),
    "label.number": str(item.number),
    "label.trackedEntityId": str(item.trackedEntityId)
  };
}

/**
 * Generate ZPL for a tracked-entity label. Honors the `trackingLabel` template:
 * only visible fields are emitted, and the text fields stack in block order
 * (QR stays top-right, the entity id stays at the bottom — same partitioning as
 * the PDF). Extension/custom blocks are skipped (no ZPL equivalent).
 */
/** Map a barcode symbology to its ZPL command for a given dot height. */
function zplBarcode(
  symbology: string,
  value: string,
  heightDots: number
): string {
  switch (symbology) {
    case "code128":
      return `^BCN,${heightDots},N,N,N^FD${value}^FS`;
    case "datamatrix":
      return `^BXN,${Math.max(3, Math.floor(heightDots / 20))},200^FD${value}^FS`;
    case "qrcode":
      return `^BQN,2,${Math.max(3, Math.floor(heightDots / 30))}^FD${value}^FS`;
    default: // pdf417
      return `^BY2^B7N,${Math.max(2, Math.floor(heightDots / 20))},5,0,0,N^FD${value}^FS`;
  }
}

export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize,
  template?: DocumentTemplate | null,
  logo?: { gfa?: string | null; widthDots?: number } | null
): string {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;

  // Convert inches to dots based on DPI
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  // Determine if this is a small or large label
  const isSmallLabel = width <= 2.5; // Consider 2x1 as small

  // Calculate positions based on label size
  const textStartX = 20;
  const fontSize = isSmallLabel ? 25 : 35; // Smaller font for small labels
  const descFontSize = isSmallLabel ? 18 : 25;
  const smallFontSize = isSmallLabel ? 12 : 18;
  const headingGap = isSmallLabel ? 35 : 50;
  const descGap = isSmallLabel ? 25 : 35;

  // QR code positioning and sizing
  const qrSize = isSmallLabel
    ? Math.min(heightDots * 0.6, widthDots * 0.35) // Smaller QR for small labels
    : Math.min(heightDots * 0.7, widthDots * 0.25); // Larger QR with more space on bigger labels

  const qrStartX = isSmallLabel
    ? widthDots - qrSize - 15 // Tighter spacing on small labels
    : widthDots - qrSize - 40; // More spacing on larger labels

  const resolved = resolveTemplate("trackingLabel", template ?? null);
  const visibleBlocks = resolved.blocks.filter((block) => block.visible);
  const vars = labelVars(item);

  let zpl = "^XA"; // Start format
  zpl += `^PW${widthDots}`;
  zpl += `^LL${heightDots}`;

  // Text fields stack from the top, following block order.
  let yPosition = 30;
  const textLine = (size: number, text: string) => {
    zpl += `^FO${textStartX},${yPosition}^A0N,${size},${size}^FD${text}^FS`;
  };

  for (const block of visibleBlocks) {
    switch (block.type) {
      case "labelHeading":
        if (item.itemId) {
          textLine(fontSize, item.itemId);
          yPosition += headingGap;
        }
        break;
      case "labelRevision":
        if (item.revision) {
          textLine(descFontSize, `${block.label || "Rev"}: ${item.revision}`);
          yPosition += descGap;
        }
        break;
      case "labelQuantity":
        if (["Serial", "Batch"].includes(item.trackingType)) {
          textLine(descFontSize, `${block.label || "Qty"}: ${item.quantity}`);
          yPosition += descGap;
        }
        break;
      case "labelTracking":
        if (item.number && ["Serial", "Batch"].includes(item.trackingType)) {
          const defaultName = item.trackingType === "Serial" ? "S/N" : "Batch";
          textLine(
            descFontSize,
            `${block.label || defaultName}: ${item.number}`
          );
          yPosition += descGap;
        }
        break;
      case "labelEntityId": {
        // Human-readable identifier text at the bottom (interpolated value).
        const value = interpolateString(block.value ?? "", vars);
        if (value) {
          const idYPosition = isSmallLabel ? heightDots - 25 : heightDots - 35;
          zpl += `^FO${textStartX},${idYPosition}^A0N,${smallFontSize},${smallFontSize}^FD${value}^FS`;
        }
        break;
      }
      case "labelLogo":
        if (logo?.gfa) {
          // Top-right, like the QR slot.
          const logoW = logo.widthDots ?? Math.round(widthDots * 0.3);
          const logoX = widthDots - logoW - 15;
          zpl += `^FO${logoX > 0 ? logoX : 15},20${logo.gfa}^FS`;
        }
        break;
      case "labelBarcode": {
        const value = interpolateString(block.value ?? "", vars);
        if (value) {
          if (block.placement === "full") {
            // Full-width band that flows *below* the text (not a fixed bottom
            // offset, which collided with the last text line). Scale it to the
            // space left between the text and the bottom entity-id line.
            const gap = 6;
            // Clear the bottom entity-id line (placed at heightDots-25/-35).
            const bottomReserve = isSmallLabel ? 30 : 44;
            const bcY = yPosition + gap;
            const avail = heightDots - bottomReserve - bcY;
            const bcHeight = Math.max(
              20,
              Math.min(isSmallLabel ? 60 : 110, avail)
            );
            zpl += `^FO${textStartX},${bcY}`;
            zpl += zplBarcode(block.symbology, value, bcHeight);
            yPosition = bcY + bcHeight;
          } else if (block.placement === "center") {
            // Centered square that flows below the text (e.g. QR-only label).
            const gap = 6;
            const bottomReserve = isSmallLabel ? 30 : 44;
            const bcY = yPosition + gap;
            const avail = heightDots - bottomReserve - bcY;
            const bcSize = Math.max(20, Math.min(qrSize, avail));
            const bcX = Math.max(
              textStartX,
              Math.round((widthDots - bcSize) / 2)
            );
            zpl += `^FO${bcX},${bcY}`;
            zpl += zplBarcode(block.symbology, value, bcSize);
            yPosition = bcY + bcSize;
          } else {
            // Top-right, like the old QR slot.
            const bcHeight = isSmallLabel ? 80 : 130;
            zpl += `^FO${qrStartX},${isSmallLabel ? 30 : 40}`;
            zpl += zplBarcode(block.symbology, value, bcHeight);
          }
        }
        break;
      }
      case "field": {
        // A single authored line: "label: value" (or just the value).
        const value = interpolateString(block.value ?? "", vars);
        const text = block.label ? `${block.label}: ${value}` : value;
        if (text) {
          textLine(descFontSize, text);
          yPosition += descGap;
        }
        break;
      }
      case "customField": {
        const value = item.customFields?.[block.fieldId];
        if (value != null && value !== "") {
          textLine(descFontSize, `${block.label}: ${value}`);
          yPosition += descGap;
        }
        break;
      }
      // Rich text / key-value lists / spacers / shared sections have no
      // single-line ZPL equivalent — skip.
      default:
        break;
    }
  }

  zpl += "^XZ"; // End format
  return zpl;
}
