import { ONSHAPE_CLIENT_ID, ONSHAPE_CLIENT_SECRET } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import type { OnshapeCompaniesResponse } from "./company.type";
import type { OnshapeDocument } from "./document.type";
// OnshapeElementType is imported as a runtime value (not `import type`) because
// the STEP translation methods compare it with `===`.
import { OnshapeElementType } from "./element.type";
import type {
  OnshapeRevision,
  OnshapeRevisionsResponse
} from "./revision.type";
import type {
  OnshapeTranslationRequest,
  OnshapeTranslationResponse
} from "./translation.type";

const logger = getLogger("ee", "onshape");

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

  // Resolve the Onshape company/account id (cid) used by the Revisions API.
  async getCompanies(): Promise<OnshapeCompaniesResponse> {
    return this.request<OnshapeCompaniesResponse>("GET", `/api/v10/companies`);
  }

  // One page of released revisions for a company. The Revisions API uses an
  // UNVERSIONED /api/revisions/... path (NOT /api/v10/...).
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

  // Pagination loop over getReleasedRevisions.
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

  // Revision history for a single part number (newest-first).
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

  // Latest revision for a part number.
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

  // Full detail for a single revision (incl. versionId = sourceVid + configuration).
  async getRevisionDetail(revisionId: string): Promise<OnshapeRevision> {
    return this.request<OnshapeRevision>(
      "GET",
      `/api/revisions/${encodeURIComponent(revisionId)}`
    );
  }

  // Multi-level BOM pinned to the revision's source version + configuration.
  // Query-string matches getBillOfMaterials so the same { headers, rows } shape
  // is returned.
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

  // Translation (export) API — drawing→PDF + geometry→STEP.

  // Kick off an async drawing→PDF translation; the returned `id` is the poll
  // target. storeInDocument:false so the result is downloadable external data.
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

  // Kick off an async part-studio geometry→STEP translation.
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

  // Kick off an async assembly geometry→STEP translation.
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

  // Route to the part-studio or assembly STEP translation by element type.
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

  // Poll a single translation's status.
  async getTranslationStatus(
    translationId: string
  ): Promise<OnshapeTranslationResponse> {
    return this.request<OnshapeTranslationResponse>(
      "GET",
      `/api/translations/${translationId}`
    );
  }

  // Bounded poll until the translation is DONE/FAILED. Default budget
  // 150 × 2s = 5 min so large assembly STEP exports aren't capped; override for
  // bigger geometry.
  async pollTranslationUntilDone(
    translationId: string,
    opts: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<OnshapeTranslationResponse> {
    // A failed/partial POST can return a body with no `id`; guard so we don't
    // poll `/api/translations/undefined` until the cap.
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

  // Download the produced file (binary) — hits axios directly with
  // responseType "arraybuffer" to bypass `request`'s JSON parse.
  async downloadExternalData(
    documentId: string,
    externalDataId: string
  ): Promise<ArrayBuffer> {
    const response = await this.axiosInstance.request<ArrayBuffer>({
      method: "GET",
      url: `/api/documents/d/${documentId}/externaldata/${externalDataId}`,
      responseType: "arraybuffer",
      // Onshape returns 406 for the raw PDF/STEP blob when Accept is JSON-only;
      // override to "*/*" so the server sends the binary.
      headers: { Accept: "*/*" }
    });
    return response.data;
  }

  // Poll a translation to DONE then download its first external-data blob.
  // Throws if it FAILED or produced no downloadable external data.
  async downloadTranslationResult(
    documentId: string,
    translation: OnshapeTranslationResponse,
    opts: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<Uint8Array> {
    // A failed/partial translation POST can resolve with a body that has no
    // `id`; guard so we don't poll `/api/translations/undefined` to the cap.
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
      logger.error("Failed to refresh Onshape token", { error });
      return { client: null, error: "Failed to refresh Onshape token" };
    }
  }

  return {
    client: new OnshapeClient({ baseUrl, accessToken }),
    error: null
  };
}
