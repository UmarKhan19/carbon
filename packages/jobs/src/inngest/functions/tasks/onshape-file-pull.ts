import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { getOnshapeClient, type OnshapeElementType } from "@carbon/ee/onshape";

import { inngest } from "../../client";
import { getJobDatabaseClient } from "./company-backup";
import { pullDrawingForRevision } from "./onshape/onshape-drawing.server";
import { pullGeometryForRevision } from "./onshape/onshape-geometry.server";

// Pull the controlled DRAWING PDF + STEP geometry for a newly-imported Onshape
// revision, out of band of the import request. Onshape translations can take
// minutes; running them here (retries: 3, minutes-scale poll) keeps big
// assemblies from being dropped by the request budget. Every step is non-fatal
// and idempotent (memoized on retry).

export const onshapeFilePullFunction = inngest.createFunction(
  { id: "onshape-file-pull", retries: 3 },
  { event: "carbon/onshape-file-pull" },
  async ({ event, step }) => {
    const {
      companyId,
      userId,
      revisionItemId,
      documentId,
      sourceVid,
      elementId,
      elementType,
      configuration,
      partNumber,
      readableIdWithRevision
    } = event.data;

    const serviceClient = getCarbonServiceRole();

    const onshape = await getOnshapeClient(serviceClient, companyId, userId);
    if (onshape.error || !onshape.client) {
      // Integration disconnected / token dead — nothing to pull (re-sync later).
      console.error(
        "onshape-file-pull: could not resolve Onshape client",
        onshape.error
      );
      return { skipped: true, reason: "no-onshape-client" };
    }
    const onshapeClient = onshape.client;

    const drawing = await step.run("pull-drawing", async () => {
      const res = await pullDrawingForRevision(serviceClient, onshapeClient, {
        documentId,
        sourceVid,
        configuration: configuration ?? undefined,
        itemId: revisionItemId,
        companyId,
        userId,
        partNumber
      });
      return res.data ?? { drawingPath: null, drawingRevisionLabel: null };
    });

    // Kysely client is resolved inside the step (the modelUpload write is a txn).
    await step.run("pull-geometry", async () => {
      const db = getJobDatabaseClient(1);
      const res = await pullGeometryForRevision(
        serviceClient,
        db,
        onshapeClient,
        {
          documentId,
          sourceVid,
          elementId,
          elementType: elementType as OnshapeElementType,
          configuration: configuration ?? undefined,
          readableIdWithRevision,
          itemId: revisionItemId,
          companyId,
          userId
        }
      );
      return { modelUploadId: res.data?.modelUploadId ?? null };
    });

    // Merge the drawing pointer into the revision's onshape mapping row
    // (read-merge-write so prior metadata keys survive).
    await step.run("patch-mapping-metadata", async () => {
      if (!drawing.drawingPath && !drawing.drawingRevisionLabel) {
        return { patched: false };
      }
      const existing = await serviceClient
        .from("externalIntegrationMapping")
        .select("id, metadata")
        .eq("entityType", "item")
        .eq("entityId", revisionItemId)
        .eq("integration", "onshape")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error || !existing.data) {
        return { patched: false };
      }
      const merged: Json = {
        ...((existing.data.metadata as Record<string, Json> | null) ?? {}),
        drawingPath: drawing.drawingPath,
        drawingRevisionLabel: drawing.drawingRevisionLabel
      };
      await serviceClient
        .from("externalIntegrationMapping")
        .update({ metadata: merged, lastSyncedAt: new Date().toISOString() })
        .eq("id", existing.data.id)
        .eq("companyId", companyId);
      return { patched: true };
    });

    return { done: true };
  }
);
