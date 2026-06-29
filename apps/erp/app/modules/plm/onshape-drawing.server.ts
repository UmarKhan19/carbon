import type { Database } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import {
  type OnshapeDocument,
  OnshapeElementType,
  OnshapeWVMType
} from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

import { isTranslationTimeout, REQUEST_SAFE_POLL } from "./onshape-poll.server";

// =============================================================================
// Task 23 — pull the controlled DRAWING PDF for the new revision.
//
// Flow: resolve the document's DRAWING element pinned to the revision's source
// version → translate it to PDF → poll → download the external-data blob →
// upload it under the `private` `models/` prefix (so existing storage RLS
// applies). The PDF is the purchasing SSOT; its `drawingPath` +
// `drawingRevisionLabel` are persisted in `externalIntegrationMapping.metadata`
// by the orchestrator (Task 25 → Task 14), NOT on `item.modelUploadId`
// (reserved for the STEP geometry — Task 24).
//
// A missing drawing is NON-FATAL: return { drawingPath: null,
// drawingRevisionLabel: null } and let the caller continue (the BOM is the core
// deliverable).
// =============================================================================

type DrawingElement = {
  id?: string;
  elementId?: string;
  name?: string;
  type?: string;
  elementType?: string;
  // drawing-rev metadata (≠ part rev). VERIFY-LIVE: exact field unknown.
  revision?: string;
  revisionId?: string;
  [key: string]: unknown;
};

export async function pullDrawingForRevision(
  serviceClient: SupabaseClient<Database>,
  onshapeClient: OnshapeClient,
  args: {
    documentId: string;
    sourceVid: string;
    configuration?: string;
    itemId: string;
    companyId: string;
    userId: string;
    // The released object's part number — used to prefer a matching DRAWING
    // element when more than one is present (deterministic selection).
    partNumber?: string;
  }
): Promise<{
  data: {
    drawingPath: string | null;
    drawingRevisionLabel: string | null;
  } | null;
  error: { message: string } | null;
  // True when the OnShape translation did not finish within the request-safe
  // poll budget — NON-FATAL (re-sync later), distinct from a hard failure.
  timedOut?: boolean;
  // NON-FATAL advisory (e.g. more than one drawing was found and one was chosen
  // non-deterministically). Surfaced by the orchestrator as a per-object warning.
  warning?: string;
}> {
  const { documentId, sourceVid, configuration, companyId, partNumber } = args;

  // Resolve the DRAWING element pinned to the source version.
  // VERIFY-LIVE: getElements returns the raw OnShape element array; filtering by
  // elementType=DRAWING is the documented query but unconfirmed in this repo.
  const document: OnshapeDocument = {
    documentId,
    wvm: OnshapeWVMType.VERSION,
    wvmId: sourceVid
  };

  let elements: DrawingElement[];
  try {
    const raw = await onshapeClient.getElements(
      document,
      OnshapeElementType.DRAWING
    );
    elements = Array.isArray(raw) ? (raw as DrawingElement[]) : [];
  } catch (err) {
    // Listing elements failed — treat as non-fatal (no drawing pulled).
    console.error("OnShape: failed to list drawing elements", err);
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null
    };
  }

  // Defensive client-side filter: some deployments ignore the elementType query
  // param, so re-filter to drawing elements (Batch-B fix · drawing filter).
  // When ANY element exposes a type field, REQUIRE type === "DRAWING" — never
  // accept "" / "BLOB", which would translate a non-drawing blob. Only when NO
  // element exposes a type at all do we fall back to the first element (the type
  // field is genuinely unavailable on this deployment).
  // VERIFY-LIVE: the element `type`/`elementType` value for drawings.
  const typeOf = (e: DrawingElement) =>
    (e.elementType ?? e.type ?? "").toString().toUpperCase();
  const anyTyped = elements.some((e) => typeOf(e) !== "");
  const drawings = anyTyped
    ? elements.filter((e) => typeOf(e) === "DRAWING")
    : elements;

  if (drawings.length === 0) {
    // No drawing — non-fatal skip.
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null
    };
  }

  // Selection rule (multiple drawings): prefer a DRAWING element whose name
  // contains the part number (cheap, deterministic); otherwise fall back to the
  // first. When more than one drawing exists and we could not match on the part
  // number, the choice is non-deterministic — flag a NON-FATAL warning so the
  // operator can verify the right controlled drawing was pulled.
  let multipleDrawingsWarning: string | undefined;
  let drawing = drawings[0];
  if (drawings.length > 1) {
    const pn = partNumber?.trim();
    const matched = pn
      ? drawings.find((d) =>
          (d.name ?? "").toString().toLowerCase().includes(pn.toLowerCase())
        )
      : undefined;
    if (matched) {
      drawing = matched;
    } else {
      multipleDrawingsWarning = `OnShape returned ${drawings.length} drawings; the first was chosen non-deterministically — verify the controlled drawing`;
    }
  }
  const drawingElementId = drawing.elementId ?? drawing.id;
  if (!drawingElementId) {
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null,
      warning: multipleDrawingsWarning
    };
  }

  // Read the drawing's revision label (drawing-rev ≠ part-rev, spec §2/§3.7).
  // VERIFY-LIVE: exact field on the element/properties payload is unconfirmed;
  // fall back to null.
  const drawingRevisionLabel =
    (typeof drawing.revision === "string" && drawing.revision) || null;

  // Translate → poll → download. Any failure here is NON-FATAL.
  // VERIFY-LIVE/TODO(job): the poll blocks the request; production must move this
  // pull to a background job (Inngest). Until then we use a request-safe budget
  // (REQUEST_SAFE_POLL ≈40s) and treat a timeout as a re-sync-later warning.
  try {
    const translation = await onshapeClient.translateDrawingToPdf(
      documentId,
      sourceVid,
      drawingElementId,
      configuration ? { configuration } : {}
    );
    const pdfBytes = await onshapeClient.downloadTranslationResult(
      documentId,
      translation,
      REQUEST_SAFE_POLL
    );

    // Upload the PDF directly under the `models/` prefix (existing RLS applies).
    // It is NOT a modelUpload row — the controlled drawing has no model slot and
    // no migrations are allowed; its location is persisted in mapping metadata.
    const drawingPath = `${companyId}/models/${nanoid()}.pdf`;
    const upload = await serviceClient.storage
      .from("private")
      .upload(
        drawingPath,
        new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
        {
          upsert: true,
          contentType: "application/pdf"
        }
      );
    if (upload.error) {
      console.error("OnShape: failed to upload drawing PDF", upload.error);
      return {
        data: { drawingPath: null, drawingRevisionLabel },
        error: null,
        warning: multipleDrawingsWarning
      };
    }

    return {
      data: { drawingPath, drawingRevisionLabel },
      error: null,
      warning: multipleDrawingsWarning
    };
  } catch (err) {
    // A poll-budget timeout is NON-FATAL — the translation is still processing on
    // OnShape's side; flag it so the caller can warn "re-sync later". A genuine
    // translate/download failure is also non-fatal here (the BOM is the core
    // deliverable) but is not flagged as a timeout.
    if (isTranslationTimeout(err)) {
      console.warn(
        "OnShape: drawing PDF translation still processing (poll timed out)"
      );
      return {
        data: { drawingPath: null, drawingRevisionLabel },
        error: null,
        timedOut: true,
        warning: multipleDrawingsWarning
      };
    }
    console.error("OnShape: drawing PDF translation/download failed", err);
    return {
      data: { drawingPath: null, drawingRevisionLabel },
      error: null,
      warning: multipleDrawingsWarning
    };
  }
}
