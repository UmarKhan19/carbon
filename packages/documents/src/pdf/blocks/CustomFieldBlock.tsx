import { Text, View } from "@react-pdf/renderer";
import type { CustomFieldBlock as CustomFieldBlockType } from "../../template";
import { tw } from "./tw";
import type { SalesInvoiceData } from "./types";

function formatValue(raw: unknown): string {
  if (raw === "on" || raw === true) return "Yes";
  if (raw === "off" || raw === false) return "No";
  if (raw == null) return "—";
  return String(raw);
}

export function CustomFieldBlock({
  block,
  data
}: {
  block: CustomFieldBlockType;
  data: SalesInvoiceData;
}) {
  const customFields = (data.salesInvoice?.customFields ?? {}) as Record<
    string,
    unknown
  >;
  const value = formatValue(customFields[block.fieldId]);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row p-3 text-[9px]")}>
        <Text style={tw("w-1/3 text-gray-600")}>{block.label || "—"}</Text>
        <Text style={tw("w-2/3 text-gray-800")}>{value}</Text>
      </View>
    </View>
  );
}
