import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import { tw } from "./tw";
import type { LabelData } from "./types";

/** Item ID — the bold label heading. */
export function LabelHeadingBlock({ data }: { data: LabelData }) {
  const { item, titleFontSize } = data;
  if (!item.itemId) return null;
  return (
    <Text
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
        ...tw("mb-2"),
        fontWeight: "bold",
        fontSize: `${titleFontSize}pt`
      }}
    >
      {item.itemId}
    </Text>
  );
}

/** Revision row. */
export function LabelRevisionBlock({ data }: { data: LabelData }) {
  const { item, descriptionFontSize } = data;
  if (!item.revision) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      Rev: {item.revision}
    </Text>
  );
}

/** Quantity row (serial/batch-tracked items only). */
export function LabelQuantityBlock({ data }: { data: LabelData }) {
  const { item, descriptionFontSize } = data;
  if (!["Serial", "Batch"].includes(item.trackingType)) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      Qty: {item.quantity}
    </Text>
  );
}

/** Serial / Batch number row. */
export function LabelTrackingBlock({ data }: { data: LabelData }) {
  const { item, descriptionFontSize } = data;
  if (!item.number) return null;
  const prefix =
    item.trackingType === "Serial"
      ? "S/N"
      : item.trackingType === "Batch"
        ? "Batch"
        : null;
  if (!prefix) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      {prefix}: {item.number}
    </Text>
  );
}

/** QR code of the tracked-entity id. */
export function LabelQrCodeBlock({ data }: { data: LabelData }) {
  const { item, qrCodeSize } = data;
  if (!item.trackedEntityId) return null;
  return (
    <View style={tw("flex items-center justify-center mb-1")}>
      <Image
        src={generateQRCode(item.trackedEntityId, qrCodeSize / 72)}
        style={{ width: qrCodeSize, height: qrCodeSize, objectFit: "contain" }}
      />
    </View>
  );
}

/** Tracked-entity id, shown as text. */
export function LabelEntityIdBlock({ data }: { data: LabelData }) {
  const { item, descriptionFontSize } = data;
  if (!item.trackedEntityId) return null;
  return (
    <Text
      style={{
        ...tw("mt-1 text-center"),
        fontSize: `${descriptionFontSize - 1}pt`,
        width: "100%"
      }}
    >
      {item.trackedEntityId}
    </Text>
  );
}
