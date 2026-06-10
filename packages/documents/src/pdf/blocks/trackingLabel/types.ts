import type { ProductLabelItem } from "@carbon/utils";
import type {
  DocumentBlock,
  DocumentTheme,
  ResolvedSection
} from "../../../template";

/** Everything a tracking-label block renderer might need (one label's worth). */
export interface LabelData {
  item: ProductLabelItem;
  theme: DocumentTheme;
  vars: Record<string, string>;
  /** Font sizes derived from the chosen label stock (set per render). */
  titleFontSize: number;
  descriptionFontSize: number;
  qrCodeSize: number;
  sections: Record<string, ResolvedSection>;
}

export type BlockRenderer = (args: {
  block: DocumentBlock;
  data: LabelData;
}) => JSX.Element | null;
