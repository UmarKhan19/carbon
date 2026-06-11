import { Image, Text, View } from "@react-pdf/renderer";
import { generateBarcode } from "../../../qr/barcode";
import { generateQRCode } from "../../../qr/qr-code";
import type {
  FieldBlock,
  LabelBarcodeBlock as LabelBarcodeBlockType,
  LabelLogoBlock as LabelLogoBlockType,
  LabelNamedBlock
} from "../../../template";
import { interpolateString } from "../../../template";
import { tw } from "./tw";
import type { LabelData } from "./types";

/**
 * A two-column field row: name column (fixed width, so rows align) + value.
 * With no name, the value spans the row (plain text).
 */
function LabelFieldRow({
  name,
  value,
  data
}: {
  name?: string;
  value: string;
  data: LabelData;
}) {
  if (!value) return null;
  const fontSize = `${data.descriptionFontSize}pt`;
  if (!name) {
    return <Text style={{ ...tw("mb-1"), fontSize }}>{value}</Text>;
  }
  return (
    <View style={tw("flex flex-row mb-1")}>
      <Text style={{ width: data.labelColWidth, fontSize }}>{name}:</Text>
      <Text style={{ flex: 1, fontSize }}>{value}</Text>
    </View>
  );
}

/** A single authored line: `label: value` (or just the value when no label). */
export function LabelFieldBlock({
  block,
  data
}: {
  block: FieldBlock;
  data: LabelData;
}) {
  return (
    <LabelFieldRow
      name={block.label || undefined}
      value={interpolateString(block.value ?? "", data.vars)}
      data={data}
    />
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
  if (!data.item.revision) return null;
  return (
    <LabelFieldRow
      name={block.label || "Rev"}
      value={String(data.item.revision)}
      data={data}
    />
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
  if (!["Serial", "Batch"].includes(data.item.trackingType)) return null;
  return (
    <LabelFieldRow
      name={block.label || "Qty"}
      value={String(data.item.quantity ?? "")}
      data={data}
    />
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
  const { item } = data;
  if (!item.number) return null;
  const defaultName =
    item.trackingType === "Serial"
      ? "S/N"
      : item.trackingType === "Batch"
        ? "Batch"
        : null;
  if (!defaultName) return null;
  return (
    <LabelFieldRow
      name={block.label || defaultName}
      value={String(item.number)}
      data={data}
    />
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

/** A configurable barcode (full width). */
export function LabelBarcodeBlock({
  block,
  data
}: {
  block: LabelBarcodeBlockType;
  data: LabelData;
}) {
  const value = interpolateString(block.value ?? "", data.vars);
  if (!value) return null;
  const height = block.height ?? 56;
  // 2D codes are square-ish; the linear PDF417/Code128 stretch full width.
  const isSquare =
    block.symbology === "qrcode" || block.symbology === "datamatrix";
  return (
    <View style={tw("w-full flex items-center mt-1")}>
      <Image
        src={generateBarcode(value, block.symbology, {
          height: block.symbology === "pdf417" ? 8 : 12
        })}
        style={{
          width: isSquare ? height : "100%",
          height,
          objectFit: "contain"
        }}
      />
    </View>
  );
}

/** The company logo (color, or the monochrome variant when toggled / for ZPL). */
export function LabelLogoBlock({
  block,
  data
}: {
  block: LabelLogoBlockType;
  data: LabelData;
}) {
  const src = block.monochrome
    ? (data.logo?.mono ?? data.logo?.color ?? data.company?.logoLight)
    : (data.logo?.color ?? data.company?.logoLight);
  if (!src) return null;
  const height = block.height ?? 50;
  return (
    <View style={tw("flex items-end mb-1")}>
      <Image
        src={src}
        style={{ height, width: "auto", objectFit: "contain" }}
      />
    </View>
  );
}
