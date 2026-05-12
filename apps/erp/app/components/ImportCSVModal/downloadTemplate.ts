import Papa from "papaparse";
import { fieldMappings } from "~/modules/shared";

type FieldDef = {
  label: string;
  required: boolean;
  type: "string" | "number" | "boolean" | "date" | "currency" | "enum";
  enumData?: {
    default: string;
    description?: string;
    options?: readonly string[];
    fetcher?: unknown;
  };
};

const exampleValueFor = (label: string, field: FieldDef): string => {
  switch (field.type) {
    case "number":
      return "100";
    case "currency":
      return "9.99";
    case "boolean":
      return "true";
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "enum":
      return field.enumData?.default ?? "";
    default:
      return label;
  }
};

const buildEnumHints = (mapping: Record<string, FieldDef>): string[] => {
  const lines: string[] = [];
  for (const field of Object.values(mapping)) {
    if (field.type !== "enum" || !field.enumData) continue;
    const { options, fetcher, default: defaultValue } = field.enumData;
    if (options && options.length > 0) {
      const joined = options.join(" | ");
      const def = defaultValue ? ` (default: ${defaultValue})` : "";
      lines.push(`# ${field.label}: ${joined}${def}`);
    } else if (fetcher) {
      lines.push(
        `# ${field.label}: choose from your configured ${field.label.toLowerCase()}`
      );
    }
  }
  return lines;
};

export const downloadTemplate = (table: keyof typeof fieldMappings) => {
  const mapping = fieldMappings[table] as Record<string, FieldDef>;
  const labels = Object.values(mapping).map((field) => field.label);
  const exampleRow = Object.entries(mapping).map(([_, field]) =>
    exampleValueFor(field.label, field)
  );

  const enumHints = buildEnumHints(mapping);
  const header = [
    `# Carbon ${table} import template`,
    ...enumHints,
    "# Edit the example row below or replace it with your data. Leading lines that start with # are ignored on upload."
  ].join("\n");

  const csvBody = Papa.unparse({
    fields: labels,
    data: [exampleRow]
  });

  const csv = `${header}\n${csvBody}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${table}-template-${today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
