import fs from "node:fs/promises";
import path from "node:path";
import enSales from "../packages/locale/src/translations/en/sales";
import enShared from "../packages/locale/src/translations/en/shared";
import plSales from "../packages/locale/src/translations/pl/sales";
import plShared from "../packages/locale/src/translations/pl/shared";

type TranslationMap = Record<string, string>;

const shouldWrite = process.argv.includes("--write");

const translationFiles = [
  {
    objectName: "shared",
    filePath: "packages/locale/src/translations/en/shared.ts",
    translations: enShared
  },
  {
    objectName: "sales",
    filePath: "packages/locale/src/translations/en/sales.ts",
    translations: enSales
  },
  {
    objectName: "shared",
    filePath: "packages/locale/src/translations/pl/shared.ts",
    translations: plShared
  },
  {
    objectName: "sales",
    filePath: "packages/locale/src/translations/pl/sales.ts",
    translations: plSales
  }
] as const;

const sortedKeys = (translations: TranslationMap) =>
  [...Object.keys(translations)].sort((a, b) => a.localeCompare(b));

const renderFile = (objectName: string, translations: TranslationMap) => {
  const body = sortedKeys(translations)
    .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(translations[key])},`)
    .join("\n");

  return `const ${objectName} = {\n${body}\n} as const;\n\nexport default ${objectName};\n`;
};

const isSorted = (translations: TranslationMap) => {
  const keys = Object.keys(translations);
  const expected = sortedKeys(translations);
  return keys.every((key, index) => key === expected[index]);
};

async function run() {
  const failures: string[] = [];

  for (const file of translationFiles) {
    const absolutePath = path.resolve(file.filePath);
    const sortedContent = renderFile(file.objectName, file.translations);

    if (!isSorted(file.translations)) {
      failures.push(file.filePath);
    }

    if (shouldWrite) {
      await fs.writeFile(absolutePath, sortedContent, "utf8");
    }
  }

  if (failures.length > 0 && !shouldWrite) {
    console.error("Translation keys are not alphabetically sorted in:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error("Run: npm run translations:sort");
    process.exit(1);
  }

  if (shouldWrite) {
    console.log("Sorted translation keys in translation files.");
  } else {
    console.log("Translation keys are sorted.");
  }
}

void run();
