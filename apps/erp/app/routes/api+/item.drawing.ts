import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getControlledDrawing } from "~/modules/items";

// Controlled-drawing slot (plan §1): one pointer per item revision in the
// `externalIntegrationMapping` row with integration="drawing", metadata
// { drawingPath, drawingRevisionLabel, drawingSource }. This route is the
// MANUAL writer (drawingSource: "manual" — a manual pin always wins and always
// may overwrite); the Onshape file-pull job is the other writer. All reads go
// through getControlledDrawing.
//
// The client uploads the PDF to `private/<companyId>/models/<nanoid>.pdf`
// first (RLS-scoped storage), then posts the resulting path here. We merge the
// drawing keys into any existing mapping metadata and best-effort delete the
// superseded PDF.

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return { controlledDrawing: null };
  }

  const controlledDrawing = await getControlledDrawing(client, {
    itemId,
    companyId
  });
  return { controlledDrawing };
}

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
        drawingRevisionLabel: null,
        drawingSource: null
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
  // EVERY non-remove write (remove already returned above), not just "upload".
  if (!drawingPath.startsWith(`${companyId}/`)) {
    return data({ success: false, message: "Invalid drawingPath" });
  }

  const nextMetadata = {
    ...currentMetadata,
    drawingPath,
    drawingRevisionLabel,
    drawingSource: "manual"
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
