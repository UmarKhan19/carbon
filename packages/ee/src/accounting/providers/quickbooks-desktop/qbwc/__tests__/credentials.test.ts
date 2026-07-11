import { describe, expect, it } from "vitest";
import {
  CARBON_QBWC_OWNER_ID,
  generateConnectionCredentials,
  hashPassword,
  rotateConnectionPassword,
  verifyPassword
} from "../credentials";
import { buildQwcFile, formatQwcGuid } from "../qwc-file";

const GUID_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

describe("CARBON_QBWC_OWNER_ID", () => {
  it("is the fixed Carbon application GUID — it must never change", () => {
    // QuickBooks keys the admin's application grant to this OwnerID across
    // every connected company file. If this test fails, the constant was
    // edited — revert it.
    expect(CARBON_QBWC_OWNER_ID).toBe("C1885F59-B650-49EE-93B7-CDDC31482121");
    expect(CARBON_QBWC_OWNER_ID).toMatch(GUID_PATTERN);
  });
});

describe("generateConnectionCredentials", () => {
  it("issues username carbon-<companyId>, a random password, and GUIDs", () => {
    const credentials = generateConnectionCredentials("comp-1");

    expect(credentials.username).toBe("carbon-comp-1");
    // 24 random bytes → 32 base64url chars, no padding
    expect(credentials.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(credentials.ownerId).toBe(CARBON_QBWC_OWNER_ID);
    expect(credentials.fileId).toMatch(GUID_PATTERN);
  });

  it("issues a distinct password and fileId per call", () => {
    const first = generateConnectionCredentials("comp-1");
    const second = generateConnectionCredentials("comp-1");

    expect(first.password).not.toBe(second.password);
    expect(first.fileId).not.toBe(second.fileId);
  });
});

describe("rotateConnectionPassword", () => {
  it("rotates only the password — fileId, username, ownerId are preserved", () => {
    const existing = generateConnectionCredentials("comp-1");

    const rotated = rotateConnectionPassword({
      username: existing.username,
      ownerId: existing.ownerId,
      fileId: existing.fileId
    });

    // QuickBooks stamped fileId into the company file on first connect —
    // changing it breaks the pairing
    expect(rotated.fileId).toBe(existing.fileId);
    expect(rotated.username).toBe(existing.username);
    expect(rotated.ownerId).toBe(existing.ownerId);
    expect(rotated.password).not.toBe(existing.password);
    expect(rotated.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("mints a fileId when the connection never had one", () => {
    const rotated = rotateConnectionPassword({
      username: "carbon-comp-1",
      ownerId: CARBON_QBWC_OWNER_ID
    });

    expect(rotated.fileId).toMatch(GUID_PATTERN);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("stores scrypt$<saltB64>$<hashB64> with a 16-byte salt and 32-byte key", () => {
    const stored = hashPassword("hunter2");
    const parts = stored.split("$");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(Buffer.from(parts[1] ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(parts[2] ?? "", "base64")).toHaveLength(32);
  });

  it("salts every hash (same password, different stored values)", () => {
    expect(hashPassword("hunter2")).not.toBe(hashPassword("hunter2"));
  });

  it("verifies the round trip", () => {
    const password = generateConnectionCredentials("comp-1").password;
    expect(verifyPassword(password, hashPassword(password))).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyPassword("wrong", hashPassword("hunter2"))).toBe(false);
  });

  it("rejects tampered or malformed stored values without throwing", () => {
    const stored = hashPassword("hunter2");

    // Flip a character of the hash segment
    const [scheme, salt, hash] = stored.split("$");
    const flipped = `${scheme}$${salt}$${
      (hash?.[0] === "A" ? "B" : "A") + (hash ?? "").slice(1)
    }`;
    expect(verifyPassword("hunter2", flipped)).toBe(false);

    // Wrong scheme, wrong segment count, wrong lengths, garbage
    expect(verifyPassword("hunter2", `bcrypt$${salt}$${hash}`)).toBe(false);
    expect(verifyPassword("hunter2", "scrypt$onlyonesegment")).toBe(false);
    expect(verifyPassword("hunter2", "")).toBe(false);
    expect(
      verifyPassword(
        "hunter2",
        `scrypt$${Buffer.from("short").toString("base64")}$${hash}`
      )
    ).toBe(false);
    expect(verifyPassword("hunter2", "scrypt$!!!$???")).toBe(false);
  });
});

describe("buildQwcFile", () => {
  const args = {
    appUrl: "https://app.carbon.ms/api/integrations/quickbooks-desktop/qbwc",
    username: "carbon-comp-1",
    ownerId: CARBON_QBWC_OWNER_ID,
    fileId: "9AF4A087-1234-4ABC-8DEF-0123456789AB"
  };

  it("builds the .qwc XML (golden snapshot)", () => {
    expect(buildQwcFile(args)).toBe(
      '<?xml version="1.0"?>\n' +
        "<QBWCXML>\n" +
        "  <AppName>Carbon</AppName>\n" +
        "  <AppID></AppID>\n" +
        "  <AppURL>https://app.carbon.ms/api/integrations/quickbooks-desktop/qbwc</AppURL>\n" +
        "  <AppDescription>Syncs Carbon customers, vendors, documents, and journal entries to QuickBooks Desktop</AppDescription>\n" +
        "  <AppSupport>https://app.carbon.ms/support</AppSupport>\n" +
        "  <UserName>carbon-comp-1</UserName>\n" +
        "  <OwnerID>{C1885F59-B650-49EE-93B7-CDDC31482121}</OwnerID>\n" +
        "  <FileID>{9AF4A087-1234-4ABC-8DEF-0123456789AB}</FileID>\n" +
        "  <QBType>QBFS</QBType>\n" +
        "  <Scheduler>\n" +
        "    <RunEveryNMinutes>5</RunEveryNMinutes>\n" +
        "  </Scheduler>\n" +
        "  <IsReadOnly>false</IsReadOnly>\n" +
        "</QBWCXML>\n"
    );
  });

  it("derives AppSupport from the AppURL origin (same-domain rule)", () => {
    const qwc = buildQwcFile({
      ...args,
      appUrl: "https://erp.example.com/api/integrations/quickbooks-desktop/qbwc"
    });

    expect(qwc).toContain(
      "<AppSupport>https://erp.example.com/support</AppSupport>"
    );
  });

  it("brace-wraps and uppercases OwnerID/FileID from bare lowercase input", () => {
    const qwc = buildQwcFile({
      ...args,
      fileId: "9af4a087-1234-4abc-8def-0123456789ab"
    });

    expect(qwc).toContain(
      "<FileID>{9AF4A087-1234-4ABC-8DEF-0123456789AB}</FileID>"
    );
  });

  it("escapes XML-significant characters in the username", () => {
    const qwc = buildQwcFile({ ...args, username: "carbon-a&b<c>" });

    expect(qwc).toContain("<UserName>carbon-a&amp;b&lt;c&gt;</UserName>");
  });

  it("rejects a non-https AppURL (the Web Connector would refuse it)", () => {
    expect(() =>
      buildQwcFile({ ...args, appUrl: "http://app.carbon.ms/api/qbwc" })
    ).toThrow(/must be https/);
    expect(() => buildQwcFile({ ...args, appUrl: "not a url" })).toThrow(
      /not a valid absolute URL/
    );
  });

  it("exempts localhost from the https requirement (dev)", () => {
    for (const appUrl of [
      "http://localhost:3000/api/integrations/quickbooks-desktop/qbwc",
      "http://127.0.0.1:3000/api/integrations/quickbooks-desktop/qbwc"
    ]) {
      expect(buildQwcFile({ ...args, appUrl })).toContain(
        `<AppURL>${appUrl}</AppURL>`
      );
    }
  });

  it("rejects an invalid OwnerID/FileID GUID", () => {
    expect(() => buildQwcFile({ ...args, fileId: "not-a-guid" })).toThrow(
      /Invalid QWC GUID/
    );
  });
});

describe("formatQwcGuid", () => {
  it("normalizes bare, braced, and lowercase GUIDs to braced uppercase", () => {
    const expected = "{9AF4A087-1234-4ABC-8DEF-0123456789AB}";

    expect(formatQwcGuid("9AF4A087-1234-4ABC-8DEF-0123456789AB")).toBe(
      expected
    );
    expect(formatQwcGuid("9af4a087-1234-4abc-8def-0123456789ab")).toBe(
      expected
    );
    expect(formatQwcGuid("{9af4a087-1234-4abc-8def-0123456789ab}")).toBe(
      expected
    );
  });

  it("throws on malformed GUIDs", () => {
    expect(() => formatQwcGuid("")).toThrow(/Invalid QWC GUID/);
    expect(() => formatQwcGuid("9AF4A087")).toThrow(/Invalid QWC GUID/);
    expect(() => formatQwcGuid("ZZZZZZZZ-1234-4ABC-8DEF-0123456789AB")).toThrow(
      /Invalid QWC GUID/
    );
  });
});
