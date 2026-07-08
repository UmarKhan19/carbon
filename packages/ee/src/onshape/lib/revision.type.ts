import type { OnshapeElementType } from "./element.type";

// A single released revision record (GET /api/revisions/companies/{cid})
export interface OnshapeRevision {
  id: string; // immutable revisionId → externalId
  partNumber: string | null; // part number; null until released
  revision: string; // Onshape revision label, e.g. "B"
  companyId: string; // Onshape cid
  partId?: string; // transient breadcrumb only
  elementType: OnshapeElementType | string;
  elementId?: string;
  documentId: string; // did
  versionId: string; // sourceVid — the v/{vid} read anchor
  versionName?: string;
  configurationId?: string | null;
  fullConfiguration?: string | null;
  viewRef?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  effectiveAt?: string | null;
  releaseId?: string; // release package id
  mimeType?: string;
}

export interface OnshapeRevisionsResponse {
  items: OnshapeRevision[];
  next?: string | null; // pagination cursor (full URL)
  previous?: string | null;
  href?: string;
}
