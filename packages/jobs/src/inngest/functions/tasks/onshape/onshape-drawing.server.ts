import type { Database } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import {
  type OnshapeDocument,
  OnshapeElementType,
  OnshapeWVMType
} from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

import { BACKGROUND_POLL, isTranslationTimeout } from "./onshape-poll.server";

// Pull the controlled DRAWING PDF for the new revision: resolve the DRAWING
// element (pinned to the revision's source version) → translate → poll →
// download → upload under the `private` `models/` prefix. Its path + revision
// label are persisted in externalIntegrationMapping.metadata by the caller
// (item.modelUploadId is reserved for the STEP geometry). A missing drawing is
// non-fatal.

type DrawingElement = {
  id?: string;
  elementId?: string;
  name?: string;
  type?: string;
  elementType?: string;
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
    poll?: { maxAttempts: number; delayMs: number };
  }
): Promise<{
  data: {
    drawingPath: string | null;
    drawingRevisionLabel: string | null;
  } | null;
  error: { message: string } | null;
  // True when the Onshape translation did not finish within the poll budget —
  // NON-FATAL (re-sync later), distinct from a hard failure.
  timedOut?: boolean;
  // NON-FATAL advisory (e.g. more than one drawing was found and one was chosen
  // non-deterministically).
  warning?: string;
}> {
  const {
    documentId,
    sourceVid,
    configuration,
    companyId,
    partNumber,
    poll = BACKGROUND_POLL
  } = args;

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
    console.error("Onshape: failed to list drawing elements", err);
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null
    };
  }

  // Defensive client-side filter: some deployments ignore the elementType query
  // param, so re-filter to drawing elements. When ANY element exposes a type
  // field, REQUIRE type === "DRAWING" — never accept "" / "BLOB". Only when NO
  // element exposes a type at all do we fall back to the first element.
  const typeOf = (e: DrawingElement) =>
    (e.elementType ?? e.type ?? "").toString().toUpperCase();
  const anyTyped = elements.some((e) => typeOf(e) !== "");
  const drawings = anyTyped
    ? elements.filter((e) => typeOf(e) === "DRAWING")
    : elements;

  if (drawings.length === 0) {
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null
    };
  }

  // Selection rule (multiple drawings): prefer a DRAWING element whose name
  // contains the part number; otherwise fall back to the first, and flag a
  // NON-FATAL warning so the operator can verify the right controlled drawing.
  let multipleDrawingsWarning: string | undefined;
  const first = drawings[0];
  if (!first) {
    return {
      data: { drawingPath: null, drawingRevisionLabel: null },
      error: null
    };
  }
  let drawing = first;
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
      multipleDrawingsWarning = `Onshape returned ${drawings.length} drawings; the first was chosen non-deterministically — verify the controlled drawing`;
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

  // Read the drawing's revision label (drawing-rev ≠ part-rev); fall back to null.
  const drawingRevisionLabel =
    (typeof drawing.revision === "string" && drawing.revision) || null;

  // Translate → poll → download; any failure is non-fatal.
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
      poll
    );

    // Upload the PDF directly under the `models/` prefix (existing RLS applies).
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
      console.error("Onshape: failed to upload drawing PDF", upload.error);
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
    if (isTranslationTimeout(err)) {
      console.warn(
        "Onshape: drawing PDF translation still processing (poll timed out)"
      );
      return {
        data: { drawingPath: null, drawingRevisionLabel },
        error: null,
        timedOut: true,
        warning: multipleDrawingsWarning
      };
    }
    console.error("Onshape: drawing PDF translation/download failed", err);
    return {
      data: { drawingPath: null, drawingRevisionLabel },
      error: null,
      warning: multipleDrawingsWarning
    };
  }
}
