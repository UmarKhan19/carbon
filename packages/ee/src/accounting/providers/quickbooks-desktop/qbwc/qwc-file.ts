import { xmlEscape } from "../qbxml/envelope";

/**
 * .QWC file generation — the XML descriptor the customer installs into the
 * QuickBooks Web Connector. It tells QBWC where Carbon's SOAP endpoint
 * lives (AppURL), which login name to use (UserName), and pairs the
 * connection to QuickBooks via OwnerID (the fixed Carbon application GUID)
 * and FileID (per-connection, stamped into the company file on first
 * connect).
 */

const GUID_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/**
 * QBWC requires OwnerID/FileID in registry format: braces, uppercase —
 * `{9AF4A087-...}`. Accepts a bare or already-braced GUID in any case.
 */
export function formatQwcGuid(id: string): string {
  const bare = id.trim().replace(/^\{/, "").replace(/\}$/, "").toUpperCase();
  if (!GUID_PATTERN.test(bare)) {
    throw new Error(
      `Invalid QWC GUID "${id}" — expected 8-4-4-4-12 hex (with or without braces)`
    );
  }
  return `{${bare}}`;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * The Web Connector refuses plain-http AppURLs except on localhost, so
 * fail fast at generation time instead of shipping a .qwc that QBWC will
 * reject. Returns the parsed URL for origin reuse (AppSupport).
 */
function assertQwcAppUrl(appUrl: string): URL {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error(`QWC AppURL "${appUrl}" is not a valid absolute URL`);
  }

  if (url.protocol !== "https:" && !isLocalhost(url.hostname)) {
    throw new Error(
      `QWC AppURL must be https (got "${appUrl}") — the Web Connector only allows http on localhost`
    );
  }

  return url;
}

export interface BuildQwcFileArgs {
  /**
   * Absolute URL of the QBWC SOAP endpoint
   * (`/api/integrations/quickbooks-desktop/qbwc`). https required;
   * localhost is exempt for dev.
   */
  appUrl: string;
  /** The connection's QBWC login name (`carbon-<companyId>`). */
  username: string;
  /** CARBON_QBWC_OWNER_ID — bare or braced GUID. */
  ownerId: string;
  /** The connection's FileID — bare or braced GUID. */
  fileId: string;
}

/**
 * Build the .qwc XML. Element order follows Intuit's QWC layout; AppID is
 * a required-but-empty tag; AppSupport must share the AppURL's domain
 * (QBWC enforces same-origin), so it is derived from the AppURL origin.
 * QBType QBFS = desktop QuickBooks company file (not Point of Sale);
 * RunEveryNMinutes 5 = QBWC polls the endpoint every 5 minutes.
 */
export function buildQwcFile(args: BuildQwcFileArgs): string {
  const url = assertQwcAppUrl(args.appUrl);
  const appUrl = xmlEscape(args.appUrl);
  const appSupport = xmlEscape(`${url.origin}/support`);
  const username = xmlEscape(args.username);
  const ownerId = formatQwcGuid(args.ownerId);
  const fileId = formatQwcGuid(args.fileId);

  return `<?xml version="1.0"?>
<QBWCXML>
  <AppName>Carbon</AppName>
  <AppID></AppID>
  <AppURL>${appUrl}</AppURL>
  <AppDescription>Syncs Carbon customers, vendors, documents, and journal entries to QuickBooks Desktop</AppDescription>
  <AppSupport>${appSupport}</AppSupport>
  <UserName>${username}</UserName>
  <OwnerID>${ownerId}</OwnerID>
  <FileID>${fileId}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>5</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>
`;
}
