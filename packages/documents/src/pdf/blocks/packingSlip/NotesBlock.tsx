import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
import { Note } from "../../components";
import { tw } from "../tw";
import type { PackingSlipData } from "./types";

export function NotesBlock({ data }: { data: PackingSlipData }) {
  const notes = (data.shipment?.externalNotes ?? {}) as JSONContent;
  if (Object.keys(notes).length === 0) return null;

  return (
    <View style={tw("mb-3 w-full")}>
      <Note title="Notes" content={notes} />
    </View>
  );
}
