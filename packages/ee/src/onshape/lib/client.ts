import { ONSHAPE_CLIENT_ID, ONSHAPE_CLIENT_SECRET } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import type { OnshapeCompaniesResponse } from "./company.type";
import type { OnshapeDocument } from "./document.type";
// OnshapeElementType is imported as a runtime value (not `import type`) because
// the STEP translation methods compare it with `===` (Task 20).
import { OnshapeElementType } from "./element.type";
import type {
  OnshapeRevision,
  OnshapeRevisionsResponse
} from "./revision.type";
import type {
  OnshapeTranslationRequest,
  OnshapeTranslationResponse
} from "./translation.type";

interface OnshapeClientConfig {
  baseUrl: string;
  accessToken: string;
}

export interface OnshapePart {
  id: string;
  name: string;
  partNumber: string;
  revision: string;
  description: string;
  metadata: Record<string, string>;
}

export class OnshapeClient {
  private baseUrl: string;
  private accessToken: string;
  private axiosInstance: ReturnType<typeof axios.create>;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessToken = config.accessToken;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.getAuthHeaders()
    });
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Bearer ${this.accessToken}`
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path,
        data: body
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Onshape API error (${error.response?.status}): ${
            typeof error.response?.data === "string"
              ? error.response.data
              : JSON.stringify(error.response?.data)
          }`
        );
      }
      throw error;
    }
  }

  async getDocuments(limit: number = 20, offset: number = 0): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents?limit=${limit}&offset=${offset}`
    );
  }

  async getVersions(
    documentId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${documentId}/versions?limit=${limit}&offset=${offset}`
    );
  }

  async getElements(
    document: OnshapeDocument,
    elementType?: OnshapeElementType
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${document.documentId}/${document.wvm}/${document.wvmId}/elements${elementType ? "?elementType=" + elementType : ""}`
    );
  }

  async getBillOfMaterials(
    documentId: string,
    versionId: string,
    elementId: string
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=true&includeItemMicroversions=false&includeTopLevelAssemblyRow=true&thumbnail=false`
    );
  }

  // Task 1 — resolve the OnShape company/account id (cid) used by the Revisions API.
  async getCompanies(): Promise<OnshapeCompaniesResponse> {
    return this.request<OnshapeCompaniesResponse>("GET", `/api/v10/companies`);
  }

  // Task 3 — enumerate one page of released revisions for a company.
  // NOTE: the Revisions API uses an UNVERSIONED /api/revisions/... path (NOT /api/v10/...).
  // VERIFY-LIVE: path `/api/revisions/companies/{cid}` + query-param names (elementType,
  // latestOnly, offset, limit) against the Glassworks "Revision" API doc.
  async getReleasedRevisions(
    companyId: string,
    opts: {
      elementType?: OnshapeElementType;
      latestOnly?: boolean;
      offset?: number;
      limit?: number;
    } = {}
  ): Promise<OnshapeRevisionsResponse> {
    const params = new URLSearchParams();
    if (opts.elementType) params.set("elementType", String(opts.elementType));
    if (opts.latestOnly !== undefined)
      params.set("latestOnly", String(opts.latestOnly));
    params.set("offset", String(opts.offset ?? 0));
    params.set("limit", String(opts.limit ?? 20));
    return this.request<OnshapeRevisionsResponse>(
      "GET",
      `/api/revisions/companies/${companyId}?${params.toString()}`
    );
  }

  // Task 4 — pagination loop over getReleasedRevisions (keeps routes thin).
  async getAllReleasedRevisions(
    companyId: string,
    opts: { elementType?: OnshapeElementType; latestOnly?: boolean } = {}
  ): Promise<OnshapeRevision[]> {
    const limit = 20;
    let offset = 0;
    const all: OnshapeRevision[] = [];
    while (true) {
      const page = await this.getReleasedRevisions(companyId, {
        ...opts,
        offset,
        limit
      });
      const items = page.items ?? [];
      all.push(...items);
      if (items.length < limit) break;
      offset += limit;
    }
    return all;
  }

  // Task 5 — revision history for a single part number (history is newest-first).
  // VERIFY-LIVE: the `/partnumber/{pn}` sub-path and newest-first ordering against the
  // Glassworks "Revision" API doc. If absent, fall back to getAllReleasedRevisions +
  // client-side filter(r => r.partNumber === pn) + sort by effectiveAt.
  async getRevisionHistoryByPartNumber(
    companyId: string,
    partNumber: string,
    opts: { elementType?: OnshapeElementType } = {}
  ): Promise<OnshapeRevisionsResponse> {
    const params = new URLSearchParams();
    if (opts.elementType) params.set("elementType", String(opts.elementType));
    return this.request<OnshapeRevisionsResponse>(
      "GET",
      `/api/revisions/companies/${companyId}/partnumber/${encodeURIComponent(
        partNumber
      )}${params.toString() ? `?${params.toString()}` : ""}`
    );
  }

  // Task 5 — thin "latest" convenience over getRevisionHistoryByPartNumber.
  async getLatestRevisionByPartNumber(
    companyId: string,
    partNumber: string,
    opts: { elementType?: OnshapeElementType } = {}
  ): Promise<OnshapeRevision | null> {
    const res = await this.getRevisionHistoryByPartNumber(
      companyId,
      partNumber,
      opts
    );
    return res.items?.[0] ?? null;
  }

  // Task 6 — full detail for a single revision (incl. versionId = sourceVid + configuration).
  // VERIFY-LIVE: exact single-revision path `/api/revisions/{rid}` (vs
  // `/api/revisions/companies/{cid}/...`) against the Glassworks "Revision" API doc.
  // If only the list endpoint exists, derive detail from the already-fetched list item.
  async getRevisionDetail(revisionId: string): Promise<OnshapeRevision> {
    return this.request<OnshapeRevision>(
      "GET",
      `/api/revisions/${encodeURIComponent(revisionId)}`
    );
  }

  // Task 7 — multi-level BOM pinned to the revision's source version + configuration.
  // Mirrors getBillOfMaterials' query-string exactly so the existing BOM-flattening
  // logic works unchanged on the returned { headers, rows } shape.
  async getMultiLevelBomForRevision(
    documentId: string,
    versionId: string,
    elementId: string,
    configuration?: string
  ): Promise<any> {
    const base =
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom` +
      `?indented=true&multiLevel=true&generateIfAbsent=true` +
      `&onlyVisibleColumns=true&includeItemMicroversions=false` +
      `&includeTopLevelAssemblyRow=true&thumbnail=false`;
    const url = configuration
      ? `${base}&configuration=${encodeURIComponent(configuration)}`
      : base;
    return this.request("GET", url);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Translation (export) API — drawing→PDF (Task 19) + geometry→STEP (Task 20)
  // ───────────────────────────────────────────────────────────────────────

  // Task 19 — kick off an async drawing→PDF translation. `this.request` already
  // JSON-serializes the body and sets Content-Type: application/json.
  // Returns the async TranslationRequestResponse whose `id` is the poll target.
  // VERIFY-LIVE: POST /api/drawings/d/{did}/v/{vid}/e/{eid}/translations
  //   + the formatName "PDF" body knobs (selectablePdfText, currentSheetOnly,
  //   storeInDocument:false). If storeInDocument:true is required, the result is
  //   a new element (resultElementIds) not external data — adjust the download.
  async translateDrawingToPdf(
    documentId: string,
    versionId: string,
    elementId: string,
    body: Partial<OnshapeTranslationRequest> = {}
  ): Promise<OnshapeTranslationResponse> {
    return this.request<OnshapeTranslationResponse>(
      "POST",
      `/api/drawings/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      {
        formatName: "PDF",
        storeInDocument: false,
        selectablePdfText: true,
        currentSheetOnly: false,
        ...body
      }
    );
  }

  // Task 20 — kick off an async part-studio geometry→STEP translation.
  // VERIFY-LIVE: POST /api/partstudios/d/{did}/v/{vid}/e/{eid}/translations
  //   + the formatName "STEP" body knobs (storeInDocument:false, configuration,
  //   partIds).
  async translatePartToStep(
    documentId: string,
    versionId: string,
    elementId: string,
    body: Partial<OnshapeTranslationRequest> = {}
  ): Promise<OnshapeTranslationResponse> {
    return this.request<OnshapeTranslationResponse>(
      "POST",
      `/api/partstudios/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      { formatName: "STEP", storeInDocument: false, ...body }
    );
  }

  // Task 20 — kick off an async assembly geometry→STEP translation.
  // VERIFY-LIVE: POST /api/assemblies/d/{did}/v/{vid}/e/{eid}/translations
  //   + the formatName "STEP" body knobs (storeInDocument:false, configuration).
  async translateAssemblyToStep(
    documentId: string,
    versionId: string,
    elementId: string,
    body: Partial<OnshapeTranslationRequest> = {}
  ): Promise<OnshapeTranslationResponse> {
    return this.request<OnshapeTranslationResponse>(
      "POST",
      `/api/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      { formatName: "STEP", storeInDocument: false, ...body }
    );
  }

  // Task 20 — element-type dispatch convenience: routes partstudios vs assemblies
  // by element type (mirrors the `assemblies` route used in getBillOfMaterials).
  async translateGeometryToStep(
    documentId: string,
    versionId: string,
    elementId: string,
    elementType: OnshapeElementType,
    body: Partial<OnshapeTranslationRequest> = {}
  ): Promise<OnshapeTranslationResponse> {
    return elementType === OnshapeElementType.ASSEMBLY
      ? this.translateAssemblyToStep(documentId, versionId, elementId, body)
      : this.translatePartToStep(documentId, versionId, elementId, body);
  }

  // Task 19 — poll a single translation's status.
  // VERIFY-LIVE: GET /api/translations/{tid}
  async getTranslationStatus(
    translationId: string
  ): Promise<OnshapeTranslationResponse> {
    return this.request<OnshapeTranslationResponse>(
      "GET",
      `/api/translations/${translationId}`
    );
  }

  // Task 19 — bounded poll until the translation reaches a terminal state.
  // VERIFY-LIVE: terminal states "DONE" / "FAILED" (see translation.type.ts).
  //
  // Batch-A review fix: the poll cap is a CLEARLY-DOCUMENTED parameter. The
  // default budget is maxAttempts(150) * delayMs(2000) = 300_000ms (5 minutes),
  // chosen so large STEP exports of full assemblies are not capped at the old
  // ~60s (30 * 2000ms). Override `maxAttempts`/`delayMs` for bigger geometry.
  async pollTranslationUntilDone(
    translationId: string,
    opts: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<OnshapeTranslationResponse> {
    // Batch-A review fix: guard a missing translation id before polling — a
    // failed/partial POST can return a body with no `id`, and polling
    // `/api/translations/undefined` would loop until the cap on a 4xx.
    if (!translationId) {
      throw new Error(
        "Onshape translation id is missing — cannot poll translation status"
      );
    }
    const maxAttempts = opts.maxAttempts ?? 150;
    const delayMs = opts.delayMs ?? 2000;
    for (let i = 0; i < maxAttempts; i++) {
      const t = await this.getTranslationStatus(translationId);
      if (t.requestState === "DONE" || t.requestState === "FAILED") return t;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(
      `Onshape translation ${translationId} did not complete within ${maxAttempts} attempts`
    );
  }

  // Task 19 — download the produced file (binary). Bypasses `request`'s JSON
  // parse by hitting axios directly with responseType "arraybuffer".
  // The external-data id comes from a DONE translation's resultExternalDataIds[0].
  // VERIFY-LIVE: GET /api/documents/d/{did}/externaldata/{foreignId}
  async downloadExternalData(
    documentId: string,
    externalDataId: string
  ): Promise<ArrayBuffer> {
    const response = await this.axiosInstance.request<ArrayBuffer>({
      method: "GET",
      url: `/api/documents/d/${documentId}/externaldata/${externalDataId}`,
      responseType: "arraybuffer",
      // Batch-A review fix: override the shared axios default
      // `Accept: application/json;...` for this binary download. OnShape can
      // return 406 Not Acceptable for the raw PDF/STEP blob when the request
      // advertises a JSON-only Accept. "*/*" lets the server send the binary.
      // VERIFY-LIVE: confirm the 406-on-JSON-Accept behavior against the live
      // GET /api/documents/d/{did}/externaldata/{edid} endpoint.
      headers: { Accept: "*/*" }
    });
    return response.data;
  }

  // Task 19/20 — end-to-end convenience: poll a kicked-off translation to DONE
  // then download the first produced external-data blob. Returns the file bytes.
  // Throws if the translation FAILED or produced no downloadable external data.
  // VERIFY-LIVE: that a DONE translation exposes resultExternalDataIds (vs
  //   resultElementIds when storeInDocument:true) — see translateDrawingToPdf.
  async downloadTranslationResult(
    documentId: string,
    translation: OnshapeTranslationResponse,
    opts: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<Uint8Array> {
    // Batch-A review fix: guard a missing translation id before polling. A
    // failed/partial translation POST can resolve with a body that has no `id`;
    // polling `/api/translations/undefined` would otherwise loop to the cap.
    if (!translation.id) {
      throw new Error(
        "Onshape translation response is missing an id — translation request likely failed"
      );
    }
    const done = await this.pollTranslationUntilDone(translation.id, opts);
    if (done.requestState === "FAILED") {
      throw new Error(
        `Onshape translation ${translation.id} failed${
          done.failureReason ? `: ${done.failureReason}` : ""
        }`
      );
    }
    const externalDataId = done.resultExternalDataIds?.[0];
    if (!externalDataId) {
      throw new Error(
        `Onshape translation ${translation.id} produced no external data to download`
      );
    }
    const buffer = await this.downloadExternalData(documentId, externalDataId);
    return new Uint8Array(buffer);
  }

  static async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
  }> {
    if (!ONSHAPE_CLIENT_ID || !ONSHAPE_CLIENT_SECRET) {
      throw new Error("Onshape OAuth not configured");
    }

    const response = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET
      })
    });

    if (!response.ok) {
      throw new Error(
        `Onshape token refresh failed (${response.status}): ${await response.text()}`
      );
    }

    return response.json();
  }
}

export async function getOnshapeClient(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<
  { client: OnshapeClient; error: null } | { client: null; error: string }
> {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error || !integration.data) {
    return { client: null, error: "Onshape integration not found" };
  }

  const metadata = integration.data.metadata as Record<string, any>;
  const credentials = metadata?.credentials;

  if (!credentials?.accessToken) {
    return { client: null, error: "Onshape credentials not found" };
  }

  let accessToken = credentials.accessToken;
  const baseUrl = metadata?.baseUrl ?? "https://cad.onshape.com";

  // Refresh token if expired
  if (
    credentials.expiresAt &&
    credentials.refreshToken &&
    new Date(credentials.expiresAt) <= new Date()
  ) {
    try {
      const refreshed = await OnshapeClient.refreshAccessToken(
        credentials.refreshToken
      );

      accessToken = refreshed.access_token;

      // Persist the new tokens
      await client
        .from("companyIntegration")
        .update({
          metadata: {
            ...metadata,
            credentials: {
              ...credentials,
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            }
          },
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", "onshape")
        .eq("companyId", companyId);
    } catch (error) {
      console.error("Failed to refresh Onshape token:", error);
      return { client: null, error: "Failed to refresh Onshape token" };
    }
  }

  return {
    client: new OnshapeClient({ baseUrl, accessToken }),
    error: null
  };
}
