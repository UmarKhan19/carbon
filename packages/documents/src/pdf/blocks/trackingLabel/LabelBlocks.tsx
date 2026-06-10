import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import type { FieldBlock, LabelNamedBlock } from "../../../template";
import { interpolateString } from "../../../template";
import { tw } from "./tw";
import type { LabelData } from "./types";

/** A single authored line: `label: value` (or just the value when no label). */
export function LabelFieldBlock({
  block,
  data
}: {
  block: FieldBlock;
  data: LabelData;
}) {
  const value = interpolateString(block.value ?? "", data.vars);
  const text = block.label ? `${block.label}: ${value}` : value;
  if (!text) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${data.descriptionFontSize}pt` }}>
      {text}
    </Text>
  );
}

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
export function LabelRevisionBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  const { item, descriptionFontSize } = data;
  if (!item.revision) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      {block.label || "Rev"}: {item.revision}
    </Text>
  );
}

/** Quantity row (serial/batch-tracked items only). */
export function LabelQuantityBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  const { item, descriptionFontSize } = data;
  if (!["Serial", "Batch"].includes(item.trackingType)) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      {block.label || "Qty"}: {item.quantity}
    </Text>
  );
}

/** Serial / Batch number row. */
export function LabelTrackingBlock({
  block,
  data
}: {
  block: LabelNamedBlock;
  data: LabelData;
}) {
  const { item, descriptionFontSize } = data;
  if (!item.number) return null;
  const defaultName =
    item.trackingType === "Serial"
      ? "S/N"
      : item.trackingType === "Batch"
        ? "Batch"
        : null;
  if (!defaultName) return null;
  return (
    <Text style={{ ...tw("mb-1"), fontSize: `${descriptionFontSize}pt` }}>
      {block.label || defaultName}: {item.number}
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
