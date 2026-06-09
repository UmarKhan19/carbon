import { View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { tw } from "../tw";
import type { PackingSlipData } from "./types";

export function TermsBlock({ data }: { data: PackingSlipData }) {
  return (
    <View style={tw("w-full")}>
      <Note title="Standard Terms & Conditions" content={data.terms} />
    </View>
  );
}
