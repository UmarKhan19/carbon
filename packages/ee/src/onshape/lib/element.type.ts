import type { OnshapeDocument } from "./document.type";

export interface OnshapeElement extends OnshapeDocument {
  elementId: string;
  linkDocumentId?: string;
  configuration?: string;
  partId?: string;
}

export enum OnshapeElementType {
  ASSEMBLY = "ASSEMBLY",
  PART_STUDIO = "PARTSTUDIO",
  // Task 23 — drawing elements are pulled for the controlled drawing PDF.
  // VERIFY-LIVE: the exact `elementType` query value for drawings is "DRAWING"
  // per Glassworks; confirm against a live GET .../elements?elementType=DRAWING.
  DRAWING = "DRAWING"
}
