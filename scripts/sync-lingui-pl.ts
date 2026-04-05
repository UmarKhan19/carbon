import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sales from "../packages/locale/src/translations/pl/sales";
import shared from "../packages/locale/src/translations/pl/shared";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const plCatalogPath = path.resolve(
  currentDir,
  "../apps/erp/app/locales/pl/messages.po"
);

const dictionary = {
  ...shared,
  ...sales
} as Record<string, string>;

const toLegacyKey = (key: string) => {
  return key.replace(/\{([^{}\s]+)\}/g, "{{$1}}");
};

const normalizeInterpolation = (value: string) => {
  return value.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, "{$1}");
};

const escapePoString = (value: string) => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const unescapePoString = (value: string) => {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
};

const poContent = fs.readFileSync(plCatalogPath, "utf8");
const lines = poContent.split(/\r?\n/);

let currentMsgId: string | null = null;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const msgIdMatch = line.match(/^msgid "(.*)"$/);

  if (msgIdMatch) {
    currentMsgId = unescapePoString(msgIdMatch[1]);
    continue;
  }

  if (!line.startsWith('msgstr "') || !currentMsgId || currentMsgId === "") {
    continue;
  }

  const translation =
    dictionary[currentMsgId] ?? dictionary[toLegacyKey(currentMsgId)];
  if (!translation) continue;

  lines[index] = `msgstr "${escapePoString(normalizeInterpolation(translation))}"`;
}

fs.writeFileSync(plCatalogPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Synced Polish catalog translations: ${plCatalogPath}`);
