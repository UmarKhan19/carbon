import type { OnshapeElementType } from "@carbon/ee/onshape";

// Shared typed contracts for the Onshape released-revision import.

export type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";
export type DefaultMethodType =
  | "Make to Order"
  | "Purchase to Order"
  | "Pull from Inventory";

export type BomRow = {
  index: string;
  readableId?: string;
  revision?: string;
  readableIdWithRevision: string;
  name: string;
  id?: string;
  replenishmentSystem: ReplenishmentSystem;
  defaultMethodType: DefaultMethodType;
  // Raw Onshape "Quantity" is a string; coerced to number in toSyncPayloadRows.
  quantity: number | string;
  level: number;
  data: Record<string, any>;
};

// Must match the `sync` edge fn's onShapeDataValidator field-for-field, or it
// throws at parse.
export type SyncPayloadRow = {
  id?: string;
  index: string;
  readableId?: string;
  revision?: string;
  name: string;
  quantity: number;
  replenishmentSystem: ReplenishmentSystem;
  defaultMethodType: DefaultMethodType;
  data: Record<string, any>;
};

export type OnshapeImportResult = {
  itemId: string; // resolved/created carbon item.id (the imported revision)
  makeMethodId: string; // the imported item's Draft makeMethod
  revision: string; // carbon-computed label
  created: boolean; // true if base item family was created
  // Per-object NON-FATAL warnings (drawing/geometry pull failures). The item +
  // BOM still land; the UI can surface "drawing not pulled" etc.
  warnings?: string[];
};

export type OnshapeReleasedObject = {
  partNumber: string; // Onshape PN -> readableId. REQUIRED (refuse on null upstream)
  revisionLabel: string; // Onshape literal label e.g. "B"
  name: string;
  description?: string;
  revisionId: string; // Onshape immutable revisionId -> externalId
  did: string;
  sourceVid: string; // pinned Version read-anchor
  eid: string;
  // Element type of the released object's geometry source — routes the STEP
  // translation (assembly vs part studio). Defaults to ASSEMBLY when absent.
  elementType?: OnshapeElementType;
  mid?: string;
  configurationId?: string | null;
  fullConfiguration?: string | null;
  bomRows: BomRow[]; // already-flattened rows
  extraMetadata?: Record<string, unknown>;
};

export type ResolveItemFamily =
  | { kind: "alreadySynced"; itemId: string }
  | { kind: "family"; itemId: string }
  | { kind: "none" };
