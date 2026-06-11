import bwipjs from "@bwip-js/node";

export type BarcodeSymbology = "pdf417" | "code128" | "datamatrix" | "qrcode";

/**
 * Render a barcode to a base64 PNG data URL. react-pdf's `<Image src>` resolves
 * the returned promise, so it can be used directly in JSX. Mirrors
 * `generateQRCode` but with a selectable symbology.
 */
export async function generateBarcode(
  text: string,
  symbology: BarcodeSymbology,
  opts: { scale?: number; height?: number; includetext?: boolean } = {}
): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: symbology,
    text: text || " ",
    scale: opts.scale ?? 3,
    height: opts.height ?? 10,
    includetext: opts.includetext ?? false,
    textxalign: "center"
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
