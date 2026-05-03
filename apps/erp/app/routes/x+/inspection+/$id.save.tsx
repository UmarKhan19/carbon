import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { saveInspectionDocumentAtomic } from "~/modules/quality";
import {
  inspectionSaveAnchorsPayloadValidator,
  inspectionSaveBalloonsPayloadValidator
} from "~/modules/quality/quality.models";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id)
    return data({ success: false, message: "Missing id" }, { status: 400 });

  const formData = await request.formData();
  const pdfUrl = formData.get("pdfUrl") as string | null;
  const anchorsRaw = formData.get("anchors") as string | null;
  const balloonsRaw = formData.get("balloons") as string | null;
  const pageCountRaw = formData.get("pageCount");
  const defaultPageWidthRaw = formData.get("defaultPageWidth");
  const defaultPageHeightRaw = formData.get("defaultPageHeight");

  const pageCount =
    typeof pageCountRaw === "string" && pageCountRaw
      ? Number(pageCountRaw)
      : undefined;
  const defaultPageWidth =
    typeof defaultPageWidthRaw === "string" && defaultPageWidthRaw
      ? Number(defaultPageWidthRaw)
      : undefined;
  const defaultPageHeight =
    typeof defaultPageHeightRaw === "string" && defaultPageHeightRaw
      ? Number(defaultPageHeightRaw)
      : undefined;

  // ── Parse balloons payload ────────────────────────────────────────────────
  let balloonsParsed = { create: [], update: [], delete: [] } as ReturnType<
    typeof inspectionSaveBalloonsPayloadValidator.parse
  >;

  if (balloonsRaw) {
    try {
      const json = JSON.parse(balloonsRaw) as unknown;
      const validated = inspectionSaveBalloonsPayloadValidator.safeParse(json);
      if (!validated.success) {
        throw new Error("Invalid balloons payload");
      }
      balloonsParsed = validated.data;
    } catch {
      return data(
        { success: false, message: "Invalid balloons payload" },
        { status: 400 }
      );
    }
  }

  // ── Parse anchors payload ─────────────────────────────────────────────────
  let anchorsParsed = { create: [], update: [], delete: [] } as ReturnType<
    typeof inspectionSaveAnchorsPayloadValidator.parse
  >;

  if (anchorsRaw) {
    try {
      const json = JSON.parse(anchorsRaw) as unknown;
      const validated = inspectionSaveAnchorsPayloadValidator.safeParse(json);
      if (!validated.success) {
        throw new Error("Invalid anchors payload");
      }
      anchorsParsed = validated.data;
    } catch {
      return data(
        { success: false, message: "Invalid anchors payload" },
        { status: 400 }
      );
    }
  }

  const rpcResult = await saveInspectionDocumentAtomic(client, {
    inspectionDocumentId: id,
    companyId,
    userId,
    pdfUrl: pdfUrl ?? undefined,
    pageCount,
    defaultPageWidth,
    defaultPageHeight,
    anchors: anchorsParsed,
    balloons: balloonsParsed
  });

  if (rpcResult.error || !rpcResult.data) {
    return data(
      {
        success: false,
        message: getErrorMessage(
          rpcResult.error,
          "Failed to save inspection document"
        )
      },
      { status: 400 }
    );
  }

  return rpcResult.data as {
    success: boolean;
    balloonAnchorIdMap: Record<string, string>;
    anchors: unknown[];
    balloons: unknown[];
  };
}
