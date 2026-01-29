import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Route to serve 3D model files (GLB, GLTF) from Supabase storage
 * URL pattern: /file/model/{storage-path}
 * Example: /file/model/companyId/assembly/projectId/model.glb
 */

const SUPPORTED_MODEL_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  stl: "model/stl",
  obj: "model/obj",
  fbx: "application/octet-stream",
  step: "application/step",
  stp: "application/step",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly",
  });

  const path = params["*"];

  if (!path) {
    throw new Response("Path is required", { status: 400 });
  }

  // Security: Ensure the path contains the user's company ID
  if (!path.startsWith(companyId)) {
    throw new Response("Unauthorized", { status: 403 });
  }

  // Validate file extension
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension || !SUPPORTED_MODEL_TYPES[extension]) {
    throw new Response("Unsupported file type", { status: 400 });
  }

  const contentType = SUPPORTED_MODEL_TYPES[extension];

  // Download from Supabase storage with retry
  let fileData: Blob | null = null;
  let retries = 2;

  while (retries > 0 && !fileData) {
    const result = await client.storage.from("private").download(path);

    if (result.error) {
      console.error("Storage download error:", result.error);
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      fileData = result.data;
    }
  }

  if (!fileData) {
    throw new Response("File not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=31536000, immutable",
  });

  return new Response(fileData, { status: 200, headers });
}
