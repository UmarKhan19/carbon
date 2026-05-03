import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, Spinner } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getBalloons, getInspectionDocument } from "~/modules/quality";
import type { InspectionDocumentContent } from "~/modules/quality/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const InspectionDocumentEditor = lazy(
  () =>
    import("~/modules/quality/ui/InspectionDocument/InspectionDocumentEditor")
);

export const handle: Handle = {
  breadcrumb: (
    _params: unknown,
    data?: {
      diagram?: {
        name?: string | null;
        content?: { drawingNumber?: string | null } | null;
      };
    }
  ) =>
    data?.diagram?.name ??
    data?.diagram?.content?.drawingNumber ??
    msg`Inspection Document`,
  to: path.to.inspectionDocuments,
  module: "quality"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = await getCarbonServiceRole();
  const [diagram, balloonsResult] = await Promise.all([
    getInspectionDocument(serviceRole, id),
    getBalloons(serviceRole, id)
  ]);

  if (diagram.error) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(diagram.error, "Failed to load inspection document")
      )
    );
  }

  if (!diagram.data) {
    throw redirect(path.to.inspectionDocuments);
  }

  if (diagram.data.companyId !== companyId) {
    throw redirect(path.to.inspectionDocuments);
  }

  const balloons = balloonsResult.data ?? [];
  const anchors = balloons.map((b) => ({
    id: b.id,
    pageNumber: b.pageNumber,
    xCoordinate: b.regionX,
    yCoordinate: b.regionY,
    width: b.regionWidth,
    height: b.regionHeight
  }));

  return {
    diagram: diagram.data,
    anchors,
    balloons
  };
}

export default function BalloonDetailRoute() {
  const { diagram, anchors, balloons } = useLoaderData<typeof loader>();
  const content = diagram.content as InspectionDocumentContent | null;

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ClientOnly
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        }
      >
        {() => (
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            }
          >
            <InspectionDocumentEditor
              diagramId={diagram.id}
              name={diagram.name}
              content={content}
              anchors={anchors}
              balloons={balloons}
            />
          </Suspense>
        )}
      </ClientOnly>
    </div>
  );
}
