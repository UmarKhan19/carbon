// Translation (export) API types — Glassworks `BTTranslationRequestInfo`.
// Used by the drawing→PDF (Task 19) and geometry→STEP (Task 20) client methods.

// VERIFY-LIVE: terminal/transient request states. Glassworks documents
// ACTIVE/DONE/FAILED; PENDING is included defensively. The pollers treat
// DONE/FAILED as terminal — confirm the exact enum against a live response.
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
  configuration?: string; // the fullConfiguration encoded string (§3.5)
  partIds?: string; // restrict a part-studio STEP export to specific parts
  destinationName?: string;
  versionString?: string;
  // PDF-specific knobs
  selectablePdfText?: boolean;
  currentSheetOnly?: boolean;
  [key: string]: unknown; // format-specific knobs (e.g. STEP version)
}
