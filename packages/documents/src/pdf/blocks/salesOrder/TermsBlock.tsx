import { Text, View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { tw } from "../tw";
import type { SalesOrderData } from "./types";

export function TermsBlock({ data }: { data: SalesOrderData }) {
  const { terms, theme } = data;
  if (!terms?.content || terms.content.length === 0) return null;

  return (
    <View break>
      <View style={tw("border-b border-gray-400 mb-3 pb-2 mt-2")}>
        <Text
          style={[
            tw("text-[14px] font-bold uppercase tracking-wide"),
            { color: theme.accent }
          ]}
        >
          Terms & Conditions
        </Text>
      </View>
      <Note content={terms} />
    </View>
  );
}
