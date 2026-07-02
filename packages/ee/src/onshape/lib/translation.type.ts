// Translation (export) API types — Glassworks `BTTranslationRequestInfo`.

// PENDING is included defensively; the pollers treat DONE/FAILED as terminal.
export type OnshapeTranslationState = "ACTIVE" | "DONE" | "FAILED" | "PENDING";

export interface OnshapeTranslationResponse {
  id: string; // translationId → poll target (GET /api/translations/{id})
  requestState: OnshapeTranslationState;
  requestId?: string; // some payloads echo the request id separately from `id`
  resultDocumentId?: string;
  resultElementIds?: string[];
  resultExternalDataIds?: string[]; // download id(s) for the STEP/PDF blob
  failureReason?: string;
  name?: string;
  documentId?: string;
  versionId?: string;
  workspaceId?: string;
  href?: string;
}

export interface OnshapeTranslationRequest {
  formatName: "PDF" | "STEP" | string;
  storeInDocument?: boolean; // false → external data we download
  configuration?: string; // the fullConfiguration encoded string
  partIds?: string; // restrict a part-studio STEP export to specific parts
  destinationName?: string;
  versionString?: string;
  // PDF-specific knobs
  selectablePdfText?: boolean;
  currentSheetOnly?: boolean;
  [key: string]: unknown; // format-specific knobs (e.g. STEP version)
}
