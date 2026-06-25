import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { extract as tarExtract } from "tar-stream";

/**
 * Unpack an uploaded `.carbon.tar.gz` (a whole backup folder) into a fresh
 * `exports/<name>/` so the normal restore/import then finds it. Entries are
 * processed one at a time, so a large archive unpacks at flat memory. The raw
 * archive is the request body (never stored whole).
 *
 * NOTE: this receives the upload server-side, so a Vercel-hosted target caps the
 * body size. It's for local / self-hosted import targets (the prod -> local case).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });
  if (request.method !== "POST" || !request.body) {
    throw new Response("Expected a tar.gz body", { status: 400 });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${ts}_uploaded`;
  const dir = `exports/${name}`;

  let manifestSeen = false;
  let fileErrors = 0;

  const extract = tarExtract();
  const source = Readable.fromWeb(
    request.body as Parameters<typeof Readable.fromWeb>[0]
  );
  const gunzip = createGunzip();
  source.on("error", (err) => extract.destroy(err));
  gunzip.on("error", (err) => extract.destroy(err));

  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("error", next);
      stream.on("end", async () => {
        try {
          const rel = header.name;
          // Reject path traversal; only land files inside this backup's folder.
          if (rel.includes("..") || rel.startsWith("/")) {
            next();
            return;
          }
          if (rel === "manifest.json") manifestSeen = true;
          const up = await client.storage
            .from(companyId)
            .upload(`${dir}/${rel}`, Buffer.concat(chunks), { upsert: true });
          if (up.error) fileErrors++;
          next();
        } catch (err) {
          next(err as Error);
        }
      });
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    source.pipe(gunzip).pipe(extract);
  });

  if (!manifestSeen) {
    throw new Response("Archive is missing manifest.json", { status: 400 });
  }

  return { name, fileErrors };
}
