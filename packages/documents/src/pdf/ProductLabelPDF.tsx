import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../qr/qr-code";
import { getLabelPdfGeometry } from "./components/labelGeometry";

interface ProductLabelProps {
  items: ProductLabelItem[];
  labelSize: LabelSize;
}

/**
 * Renders one page per label, each page exactly the label size, with the
 * same layout as the ZPL generator: item id top-left, detail lines below,
 * QR code top-right, tracked entity id bottom-left.
 */
const ProductLabelPDF = ({ items, labelSize }: ProductLabelProps) => {
  const g = getLabelPdfGeometry(labelSize);
  const qrX = g.pageWidth - g.qrSize - g.margin;

  return (
    <Document>
      {items.map((item, index) => (
        <Page
          key={item.trackedEntityId || index}
          size={[g.pageWidth, g.pageHeight]}
        >
          <View
            style={{
              position: "absolute",
              left: g.margin,
              top: g.contentTop,
              maxWidth: qrX - g.margin - 4,
              flexDirection: "column"
            }}
          >
            <Text
              style={{
                fontSize: g.titleFontSize,
                fontFamily: "Helvetica-Bold",
                marginBottom: g.lineGap
              }}
            >
              {item.itemId}
            </Text>

            {item.revision && (
              <Text
                style={{ fontSize: g.descFontSize, marginBottom: g.lineGap }}
              >
                Rev: {item.revision}
              </Text>
            )}

            {["Serial", "Batch"].includes(item.trackingType) && (
              <Text
                style={{ fontSize: g.descFontSize, marginBottom: g.lineGap }}
              >
                Qty: {item.quantity}
              </Text>
            )}

            {item.trackingType === "Serial" && item.number && (
              <Text style={{ fontSize: g.descFontSize }}>
                S/N: {item.number}
              </Text>
            )}
            {item.trackingType === "Batch" && item.number && (
              <Text style={{ fontSize: g.descFontSize }}>
                Batch: {item.number}
              </Text>
            )}
          </View>

          <Image
            src={generateQRCode(item.trackedEntityId, g.qrSize / 72)}
            style={{
              position: "absolute",
              left: qrX,
              top: g.contentTop,
              width: g.qrSize,
              height: g.qrSize,
              objectFit: "contain"
            }}
          />

          {item.trackedEntityId && (
            <Text
              style={{
                position: "absolute",
                left: g.margin,
                bottom: g.bottomOffset,
                fontSize: g.smallFontSize
              }}
            >
              {item.trackedEntityId}
            </Text>
          )}
        </Page>
      ))}
    </Document>
  );
};

export default ProductLabelPDF;
