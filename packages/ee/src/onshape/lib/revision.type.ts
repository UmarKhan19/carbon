import type { OnshapeElementType } from "./element.type";

// A single released revision record (GET /api/revisions/companies/{cid})
export interface OnshapeRevision {
  id: string; // immutable revisionId → externalId
  partNumber: string | null; // PN; null until released → refuse loudly (spec §3.2 step 1)
  revision: string; // OnShape literal label e.g. "B" → metadata.revisionLabel
  companyId: string; // OnShape cid
  partId?: string; // transient breadcrumb only (spec §3.1)
  elementType: OnshapeElementType | string;
  elementId?: string;
  documentId: string; // did
  versionId: string; // sourceVid — the v/{vid} read anchor (spec §3.1)
  versionName?: string;
  configurationId?: string | null;
  fullConfiguration?: string | null;
  viewRef?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  effectiveAt?: string | null;
  releaseId?: string; // release package id → changeOrder.sourceId (Increment 3)
  mimeType?: string;
}

export interface OnshapeRevisionsResponse {
  items: OnshapeRevision[];
  next?: string | null; // pagination cursor (full URL)
  previous?: string | null;
  href?: string;
}
