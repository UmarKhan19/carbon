import { Text, View } from "@react-pdf/renderer";
import type { RichTextBlock as RichTextBlockType } from "../../template";
import { interpolateContent } from "../../template";
import { Note } from "../components";
import { tw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function RichTextBlock({
  block,
  data
}: {
  block: RichTextBlockType;
  data: SalesInvoiceData;
}) {
  const hasContent =
    block.content &&
    typeof block.content === "object" &&
    Array.isArray(block.content.content) &&
    block.content.content.length > 0;

  if (!hasContent && !block.title) return null;

  const content = hasContent
    ? interpolateContent(block.content, data.vars)
    : block.content;

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("p-3")}>
        {block.title && (
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {block.title}
          </Text>
        )}
        {hasContent && (
          <View style={tw("text-[9px] text-gray-800")}>
            <Note content={content} />
          </View>
        )}
      </View>
    </View>
  );
}
