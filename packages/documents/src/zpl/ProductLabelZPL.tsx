import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import type { DocumentTemplate } from "../template";
import { resolveTemplate } from "../template";

/**
 * Generate ZPL for a tracked-entity label. Honors the `trackingLabel` template:
 * only visible fields are emitted, and the text fields stack in block order
 * (QR stays top-right, the entity id stays at the bottom — same partitioning as
 * the PDF). Extension/custom blocks are skipped (no ZPL equivalent).
 */
export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize,
  template?: DocumentTemplate | null
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
          textLine(descFontSize, `Rev: ${item.revision}`);
          yPosition += descGap;
        }
        break;
      case "labelQuantity":
        if (["Serial", "Batch"].includes(item.trackingType)) {
          textLine(descFontSize, `Qty: ${item.quantity}`);
          yPosition += descGap;
        }
        break;
      case "labelTracking":
        if (item.trackingType === "Serial" && item.number) {
          textLine(descFontSize, `S/N: ${item.number}`);
          yPosition += descGap;
        } else if (item.trackingType === "Batch" && item.number) {
          textLine(descFontSize, `Batch: ${item.number}`);
          yPosition += descGap;
        }
        break;
      case "labelQrCode":
        if (item.trackedEntityId) {
          // QR Code for tracked entity ID — fixed top-right, independent of the
          // text stack. Error correction level M, input mode A.
          const qrYPosition = isSmallLabel ? 30 : 40;
          zpl += `^FO${qrStartX},${qrYPosition}^BQN,2,${
            isSmallLabel ? 5 : 7
          },M,A^FD${item.trackedEntityId}^FS`;
        }
        break;
      case "labelEntityId":
        if (item.trackedEntityId) {
          // Tracked entity id text at the bottom.
          const idYPosition = isSmallLabel ? heightDots - 25 : heightDots - 35;
          zpl += `^FO${textStartX},${idYPosition}^A0N,${smallFontSize},${smallFontSize}^FD${item.trackedEntityId}^FS`;
        }
        break;
      // Extension/custom blocks have no ZPL equivalent — skip.
      default:
        break;
    }
  }

  zpl += "^XZ"; // End format
  return zpl;
}
