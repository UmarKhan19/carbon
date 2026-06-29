import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Manual controlled-drawing SSOT (spec §7, Task 33). The drawing PDF rides in a
// dedicated `externalIntegrationMapping` slot (entityType="item",
// integration="drawing") — its OWN integration key, decoupled from the parked
// OnShape importer's `onshape` slot so the two can never collide/clobber each
// other's metadata. No migration is needed: the table + read paths already
// exist; this is just a distinct writer of the `{ drawingPath,
// drawingRevisionLabel }` metadata keys, read back by the same readers (all now
// keyed on integration="drawing").
//
// The client uploads the PDF to `private/<companyId>/models/<nanoid>.pdf` first
// (RLS-scoped storage), then posts the resulting path here. We merge the drawing
// keys into any existing mapping metadata (preserving OnShape sync fields) and
// best-effort delete the superseded PDF.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    return data({ success: false, message: "Missing itemId" });
  }

  const existing = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("entityType", "item")
    .eq("entityId", itemId)
    .eq("integration", "drawing")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return data({ success: false, message: existing.error.message });
  }

  const currentMetadata =
    (existing.data?.metadata as Record<string, unknown> | null) ?? {};
  const previousDrawingPath =
    typeof currentMetadata.drawingPath === "string"
      ? currentMetadata.drawingPath
      : null;
  const now = new Date().toISOString();

  if (intent === "remove") {
    if (existing.data?.id) {
      const nextMetadata = {
        ...currentMetadata,
        drawingPath: null,
        drawingRevisionLabel: null
      } as Json;
      const update = await client
        .from("externalIntegrationMapping")
        .update({ metadata: nextMetadata, updatedAt: now })
        .eq("id", existing.data.id);
      if (update.error) {
        return data({ success: false, message: update.error.message });
      }
    }
    if (previousDrawingPath) {
      await client.storage.from("private").remove([previousDrawingPath]);
    }
    return data({ success: true, message: "Controlled drawing removed" });
  }

  const drawingPath = String(formData.get("drawingPath") ?? "");
  const drawingRevisionLabelRaw = formData.get("drawingRevisionLabel");
  const drawingRevisionLabel =
    typeof drawingRevisionLabelRaw === "string" &&
    drawingRevisionLabelRaw.length > 0
      ? drawingRevisionLabelRaw
      : null;
  if (!drawingPath) {
    return data({ success: false, message: "Missing drawingPath" });
  }

  // The client supplies drawingPath, so reject any path that escapes this
  // company's storage prefix before persisting it to metadata. This guards
  // EVERY non-remove write (remove already returned above), not just "upload" —
  // any other intent reaches the same upsert below.
  if (!drawingPath.startsWith(`${companyId}/`)) {
    return data({ success: false, message: "Invalid drawingPath" });
  }

  const nextMetadata = {
    ...currentMetadata,
    drawingPath,
    drawingRevisionLabel
  } as Json;

  if (existing.data?.id) {
    const update = await client
      .from("externalIntegrationMapping")
      .update({ metadata: nextMetadata, updatedAt: now })
      .eq("id", existing.data.id);
    if (update.error) {
      return data({ success: false, message: update.error.message });
    }
  } else {
    const insert = await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: itemId,
      integration: "drawing",
      externalId: null,
      metadata: nextMetadata,
      companyId,
      createdBy: userId
    });
    if (insert.error) {
      return data({ success: false, message: insert.error.message });
    }
  }

  // Best-effort: drop the superseded PDF when replacing an existing drawing.
  if (previousDrawingPath && previousDrawingPath !== drawingPath) {
    await client.storage.from("private").remove([previousDrawingPath]);
  }

  return data({ success: true, message: "Controlled drawing uploaded" });
}
