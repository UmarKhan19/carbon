import { Text, View } from "@react-pdf/renderer";
import type { SharedBlock as SharedBlockType } from "../../template";
import { interpolateContent } from "../../template";
import { Note } from "../components";
import { tw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function SharedBlock({
  block,
  data
}: {
  block: SharedBlockType;
  data: SalesInvoiceData;
}) {
  const section = data.sections[block.sectionId];
  if (!section) return null;

  const hasContent =
    section.content &&
    typeof section.content === "object" &&
    Array.isArray(section.content.content) &&
    section.content.content.length > 0;

  if (!hasContent) return null;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
          {section.name}
        </Text>
        <View style={tw("text-[9px] text-gray-800")}>
          <Note content={interpolateContent(section.content, data.vars)} />
        </View>
      </View>
    </View>
  );
}
