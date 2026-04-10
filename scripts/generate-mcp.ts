/**
 * MCP Tool Code Generator
 *
 * Parses all *.service.ts files and generates:
 * 1. Tool registration files in apps/erp/app/modules/mcp/tools/
 * 2. Documentation in llm/cache/mcp-tools-reference.md
 *
 * Usage: npx tsx scripts/generate-mcp.ts
 */

import { Project, SyntaxKind, type Type, type Symbol as TsSymbol, type Node } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

const ROOT = path.resolve(__dirname, "..");
const MODULES_DIR = path.join(ROOT, "apps/erp/app/modules");
const MCP_LIB_DIR = path.join(ROOT, "apps/erp/app/routes/api+/mcp+/lib");
const TOOLS_DIR = path.join(MCP_LIB_DIR, "tools");
const DOCS_PATH = path.join(ROOT, "llm/cache/mcp-tools-reference.md");

// Parameters that should be auto-filled from McpContext
const CONTEXT_PARAM_NAMES = ["companyId", "userId", "createdBy", "updatedBy"];
const CONTEXT_PARAMS = new Set(CONTEXT_PARAM_NAMES);

// Classify function by prefix
function classifyFunction(name: string): "READ" | "WRITE" | "DESTRUCTIVE" {
  if (name.startsWith("delete")) return "DESTRUCTIVE";
  if (name.startsWith("get") || name.startsWith("list") || name.startsWith("fetch"))
    return "READ";
  return "WRITE";
}

function annotationConst(classification: "READ" | "WRITE" | "DESTRUCTIVE"): string {
  switch (classification) {
    case "READ":
      return "READ_ONLY_ANNOTATIONS";
    case "WRITE":
      return "WRITE_ANNOTATIONS";
    case "DESTRUCTIVE":
      return "DESTRUCTIVE_ANNOTATIONS";
  }
}

interface ParamInfo {
  name: string;
  zodSchema: string;
  tsType: string;
  isContextParam: boolean;
  isOptional: boolean;
}

interface FunctionInfo {
  name: string;
  params: ParamInfo[];
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  /** Parameters that need validator imports from .models */
  validatorImports: Set<string>;
}

interface ModuleInfo {
  moduleName: string;
  servicePath: string;
  modelsPath: string | null;
  functions: FunctionInfo[];
  /** Maps validator name → import source path (resolved from the service file's imports) */
  validatorSources: Map<string, string>;
}

/**
 * Convert a source-level type annotation to a Zod schema string.
 * This works from the raw annotation text to avoid deep type resolution
 * that would expand z.infer<typeof X> into Zod's internal class hierarchy.
 */
function annotationToZod(
  annotationText: string,
  resolvedType: Type,
  validatorImports: Set<string>
): string {
  const text = annotationText.trim();

  // No annotation — fall back to resolved type for simple cases
  if (!text) {
    if (resolvedType.isString()) return "z.string()";
    if (resolvedType.isNumber()) return "z.number()";
    if (resolvedType.isBoolean()) return "z.boolean()";
    return "z.any()";
  }

  // Simple primitives
  if (text === "string") return "z.string()";
  if (text === "number") return "z.number()";
  if (text === "boolean") return "z.boolean()";
  if (text === "Json") return "z.any()";

  // z.infer<typeof xxxValidator> — reference the validator directly
  const inferMatch = text.match(/z\.infer<typeof\s+(\w+)>/);
  if (inferMatch) {
    validatorImports.add(inferMatch[1]);
    return `${inferMatch[1]}`;
  }

  // GenericQueryFilters (with or without intersection)
  if (text.includes("GenericQueryFilters")) {
    // Extract any additional properties from intersection: GenericQueryFilters & { search: string | null }
    const extraMatch = text.match(/GenericQueryFilters\s*&\s*\{([^}]*)\}/s);
    const baseParts = [
      "    limit: z.number().int().default(100)",
      "    offset: z.number().int().default(0)",
    ];
    if (extraMatch) {
      const extraProps = parseInlineObjectProps(extraMatch[1]);
      return `z.object({\n${[...baseParts, ...extraProps].join(",\n")}\n  })`;
    }
    // Handle Omit<GenericQueryFilters, "..."> & { ... }
    if (text.includes("Omit<GenericQueryFilters")) {
      const omitMatch = text.match(/Omit<GenericQueryFilters,\s*["']([^"']+)["']>/);
      const omitKeys = omitMatch ? omitMatch[1].split("|").map(s => s.trim().replace(/['"]/g, "")) : [];
      const filteredParts = baseParts.filter(p => !omitKeys.some(k => p.includes(k)));
      const extraAfterOmit = text.match(/>\s*&\s*\{([^}]*)\}/s);
      const extraProps = extraAfterOmit ? parseInlineObjectProps(extraAfterOmit[1]) : [];
      return `z.object({\n${[...filteredParts, ...extraProps].join(",\n")}\n  })`;
    }
    return `z.object({\n${baseParts.join(",\n")}\n  })`;
  }

  // Nullable shorthand: string | null
  if (text.match(/^(\w+)\s*\|\s*null$/)) {
    const inner = text.replace(/\s*\|\s*null$/, "").trim();
    const innerZod = primitiveToZod(inner);
    return `${innerZod}.nullable()`;
  }

  // Union types involving validators or complex objects — use z.any()
  if (text.includes("|") && text.includes("z.infer")) {
    // Extract all validator names
    const validatorMatches = text.matchAll(/z\.infer<typeof\s+(\w+)>/g);
    for (const m of validatorMatches) {
      validatorImports.add(m[1]);
    }
    return "z.any()";
  }

  // Inline object type: { id: string; name: string; ... }
  if (text.startsWith("{")) {
    const inner = text.slice(1, -1);
    const props = parseInlineObjectProps(inner);
    return `z.object({\n${props.join(",\n")}\n  })`;
  }

  // Array types
  if (text.endsWith("[]")) {
    const elementType = text.slice(0, -2);
    return `z.array(${primitiveToZod(elementType)})`;
  }

  // Complex union/intersection with Omit, z.infer, etc. — too complex for auto-gen
  if (text.includes("Omit<") || text.includes("z.infer<") || text.includes("&")) {
    // Extract all validator names for imports even if we use z.any()
    const validatorMatches = text.matchAll(/z\.infer<typeof\s+(\w+)>/g);
    for (const m of validatorMatches) {
      validatorImports.add(m[1]);
    }
    return "z.any()";
  }

  // String literal type
  if (text.startsWith('"') || text.startsWith("'")) return "z.string()";

  // Named types we don't know about — z.any()
  return "z.any()";
}

/**
 * Parse inline object properties from source text like "id: string; name: string | null"
 */
function parseInlineObjectProps(propsText: string): string[] {
  const results: string[] = [];
  // Split on semicolons or newlines
  const parts = propsText.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const colonIndex = part.indexOf(":");
    if (colonIndex === -1) continue;
    let propName = part.slice(0, colonIndex).trim();
    const typeStr = part.slice(colonIndex + 1).trim();

    const isOptional = propName.endsWith("?");
    if (isOptional) propName = propName.slice(0, -1).trim();

    // Skip context params
    if (CONTEXT_PARAMS.has(propName)) continue;

    let zodType = primitiveToZod(typeStr);
    if (isOptional && !zodType.includes(".optional()")) {
      zodType += ".optional()";
    }
    results.push(`    ${propName}: ${zodType}`);
  }
  return results;
}

/**
 * Convert a primitive-ish type string to Zod
 */
function primitiveToZod(typeStr: string): string {
  const t = typeStr.trim();
  if (t === "string") return "z.string()";
  if (t === "number") return "z.number()";
  if (t === "boolean") return "z.boolean()";
  if (t === "Json") return "z.any()";
  if (t === "string | null") return "z.string().nullable()";
  if (t === "number | null") return "z.number().nullable()";
  if (t === "boolean | null") return "z.boolean().nullable()";
  if (t.endsWith("[]")) return `z.array(${primitiveToZod(t.slice(0, -2))})`;
  // String literal unions like "Draft" | "Active"
  if (t.includes('" | "') || t.includes("' | '")) {
    const values = t.split("|").map(s => s.trim().replace(/['"]/g, ""));
    return `z.enum([${values.map(v => `"${v}"`).join(", ")}])`;
  }
  return "z.any()";
}

/**
 * Safely get the type of a property symbol.
 * Falls back to z.any() representation for properties from mapped types,
 * Omit/Pick, or other type operations that lack value declarations.
 */
function getPropertyType(prop: TsSymbol): Type | null {
  const decl = prop.getValueDeclaration();
  if (decl) return decl.getType();

  // Try declarations (plural) as fallback
  const decls = prop.getDeclarations();
  if (decls.length > 0) return decls[0].getType();

  return null;
}

/**
 * Convert a TypeScript type to a Zod schema string
 */
function typeToZod(
  type: Type,
  validatorImports: Set<string>,
  depth: number = 0
): string {
  if (depth > 5) return "z.any()";

  const typeText = type.getText();

  // Check for z.infer<typeof xxxValidator> pattern
  const inferMatch = typeText.match(
    /z\.infer<typeof\s+(\w+)>/
  );
  if (inferMatch) {
    validatorImports.add(inferMatch[1]);
    return `${inferMatch[1]}`;
  }

  // Primitives
  if (type.isString() || type.isStringLiteral()) return "z.string()";
  if (type.isNumber() || type.isNumberLiteral()) return "z.number()";
  if (type.isBoolean() || type.isBooleanLiteral()) return "z.boolean()";

  // null / undefined
  if (typeText === "null") return "z.null()";
  if (typeText === "undefined") return "z.undefined()";

  // Json type
  if (typeText === "Json") return "z.any()";

  // string literal unions
  if (type.isUnion()) {
    const unionTypes = type.getUnionTypes();

    // Check if it's a nullable type (T | null)
    const nonNullTypes = unionTypes.filter((t) => t.getText() !== "null");
    const hasNull = nonNullTypes.length < unionTypes.length;
    const nonUndefinedTypes = nonNullTypes.filter(
      (t) => t.getText() !== "undefined"
    );
    const hasUndefined = nonNullTypes.length > nonUndefinedTypes.length;

    if (nonUndefinedTypes.length === 1 && (hasNull || hasUndefined)) {
      const inner = typeToZod(nonUndefinedTypes[0], validatorImports, depth + 1);
      if (hasNull && hasUndefined) return `${inner}.nullable().optional()`;
      if (hasNull) return `${inner}.nullable()`;
      return `${inner}.optional()`;
    }

    // String literal union → z.enum
    if (unionTypes.every((t) => t.isStringLiteral())) {
      const values = unionTypes.map((t) =>
        t.getText().replace(/^"/, "").replace(/"$/, "")
      );
      return `z.enum([${values.map((v) => `"${v}"`).join(", ")}])`;
    }

    // Generic union → z.union
    if (nonUndefinedTypes.length > 1) {
      const schemas = nonUndefinedTypes.map((t) =>
        typeToZod(t, validatorImports, depth + 1)
      );
      return `z.union([${schemas.join(", ")}])`;
    }
  }

  // Arrays
  if (type.isArray()) {
    const elementType = type.getArrayElementTypeOrThrow();
    return `z.array(${typeToZod(elementType, validatorImports, depth + 1)})`;
  }

  // Object types (interfaces, type literals)
  if (type.isObject() && !type.isArray()) {
    const properties = type.getProperties();
    if (properties.length === 0) return "z.object({})";

    // Check for index signatures (Record types)
    const stringIndex = type.getStringIndexType();
    if (stringIndex) {
      return `z.record(z.string(), ${typeToZod(stringIndex, validatorImports, depth + 1)})`;
    }

    const props = properties
      .map((prop) => {
        const propName = prop.getName();
        const propType = getPropertyType(prop);
        if (!propType) return `    ${propName}: z.any()`;
        const isOptional = prop.isOptional();
        let zodType = typeToZod(propType, validatorImports, depth + 1);
        if (isOptional && !zodType.includes(".optional()")) {
          zodType += ".optional()";
        }
        return `    ${propName}: ${zodType}`;
      })
      .join(",\n");

    return `z.object({\n${props}\n  })`;
  }

  // Intersection types - merge properties
  if (type.isIntersection()) {
    const intersectionTypes = type.getIntersectionTypes();
    const allProps: string[] = [];

    for (const t of intersectionTypes) {
      const zodStr = typeToZod(t, validatorImports, depth + 1);
      // If it resolves to a z.object, extract its properties
      if (zodStr.startsWith("z.object(")) {
        // We'll just use .merge pattern
        allProps.push(zodStr);
      } else {
        // It's a named validator or other type
        allProps.push(zodStr);
      }
    }

    if (allProps.length === 1) return allProps[0];
    // For intersections, use the first and merge the rest
    return allProps.reduce((acc, curr) => {
      if (acc.startsWith("z.object(") && curr.startsWith("z.object(")) {
        return `${acc}.merge(${curr})`;
      }
      return `${acc}.and(${curr})`;
    });
  }

  // Fallback
  return "z.any()";
}

/**
 * Extract function info and validator import sources from a service file
 */
function extractFunctions(
  project: Project,
  filePath: string,
  moduleName: string
): { functions: FunctionInfo[]; validatorSources: Map<string, string> } {
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Build a map of imported names → their source module path
  // This lets us know where validators are actually imported from
  const validatorSources = new Map<string, string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    for (const named of imp.getNamedImports()) {
      const name = named.getName();
      if (name.endsWith("Validator") || name.endsWith("Type") || name.endsWith("type")) {
        validatorSources.set(name, moduleSpecifier);
      }
    }
  }
  const functions: FunctionInfo[] = [];

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    if (!fn.isAsync()) continue;

    const name = fn.getName();
    if (!name) continue;

    const classification = classifyFunction(name);
    const validatorImports = new Set<string>();
    const params: ParamInfo[] = [];

    const fnParams = fn.getParameters();

    for (let i = 0; i < fnParams.length; i++) {
      const param = fnParams[i];
      let paramName = param.getName();
      const paramType = param.getType();

      // Get the source-level type annotation text (before TS resolves it)
      const typeNode = param.getTypeNode();
      const annotationText = typeNode?.getText() ?? "";
      const resolvedText = paramType.getText();

      // Skip the first parameter if it's a SupabaseClient
      if (i === 0 && (annotationText.includes("SupabaseClient") || resolvedText.includes("SupabaseClient"))) continue;

      // Handle destructured parameters — give them a synthetic name
      const isDestructured = paramName.startsWith("{") || paramName.startsWith("[");
      if (isDestructured) {
        paramName = `arg${i}`;
      }

      const isContextParam = CONTEXT_PARAMS.has(paramName);
      const isOptional = param.isOptional() || param.hasInitializer();

      let zodSchema: string;

      // Use annotation text to detect patterns BEFORE deep type resolution
      zodSchema = annotationToZod(annotationText, paramType, validatorImports);

      params.push({
        name: paramName,
        zodSchema,
        tsType: annotationText || resolvedText,
        isContextParam,
        isOptional,
      });
    }

    functions.push({ name, params, classification, validatorImports });
  }

  return { functions, validatorSources };
}

/**
 * Generate tool file content for a module
 */
function generateToolFile(module: ModuleInfo): string {
  const { moduleName, functions } = module;
  const registerName = `register${capitalize(moduleName)}Tools`;

  // Collect all validator imports needed
  const allValidatorImports = new Set<string>();
  for (const fn of functions) {
    for (const v of fn.validatorImports) {
      allValidatorImports.add(v);
    }
  }

  // Collect all function imports
  const fnNames = functions.map((f) => f.name);

  let imports = `import { z } from "zod";
import type { RegisterTools } from "../types";
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  toMcpResult,
  withErrorHandling,
} from "../types";
import {
${fnNames.map((n) => `  ${n},`).join("\n")}
} from "~/modules/${moduleName}/${moduleName}.service";`;

  // Group validator imports by their actual source module
  if (allValidatorImports.size > 0) {
    const importsBySource = new Map<string, string[]>();
    for (const v of allValidatorImports) {
      const source = module.validatorSources.get(v);
      // Resolve the import path: use the original source if available,
      // otherwise fall back to the module's own models file
      let importPath: string;
      if (source) {
        // Convert relative paths from the service file to be relative to mcp/tools/
        // Service files are at ~/modules/{mod}/{mod}.service.ts
        // Tool files are at ~/modules/mcp/tools/{mod}.ts
        // So "../shared" from items.service.ts → "~/modules/shared"
        if (source.startsWith("../")) {
          importPath = `~/modules/${source.slice(3)}`;
        } else if (source.startsWith("./")) {
          importPath = `~/modules/${moduleName}/${source.slice(2)}`;
        } else if (source.startsWith("~/")) {
          importPath = source;
        } else {
          // External package — use as-is
          importPath = source;
        }
      } else if (module.modelsPath) {
        importPath = `~/modules/${moduleName}/${moduleName}.models`;
      } else {
        continue; // Skip if no source found and no models file
      }
      if (!importsBySource.has(importPath)) {
        importsBySource.set(importPath, []);
      }
      importsBySource.get(importPath)!.push(v);
    }

    for (const [importPath, names] of importsBySource) {
      imports += `\nimport {
${names.map((n) => `  ${n},`).join("\n")}
} from "${importPath}";`;
    }
  }

  const toolRegistrations = functions
    .map((fn) => generateToolRegistration(moduleName, fn))
    .join("\n\n");

  return `// @ts-nocheck
// AUTO-GENERATED by scripts/generate-mcp.ts — do not edit manually
${imports}

export const ${registerName}: RegisterTools = (server, ctx) => {
${toolRegistrations}
};
`;
}

/**
 * Generate a single tool registration
 */
function generateToolRegistration(moduleName: string, fn: FunctionInfo): string {
  const toolName = `${moduleName}_${fn.name}`;
  const annotation = annotationConst(fn.classification);

  // Build the input schema
  const inputSchemaEntries: string[] = [];
  const callArgs: string[] = ["ctx.client"];

  for (const param of fn.params) {
    if (param.isContextParam) {
      // Auto-fill from context
      if (param.name === "companyId") callArgs.push("ctx.companyId");
      else if (param.name === "userId") callArgs.push("ctx.userId");
      else if (param.name === "createdBy") callArgs.push("ctx.userId");
      else if (param.name === "updatedBy") callArgs.push("ctx.userId");
      continue;
    }

    // For object params that have context fields filtered out, we need special handling
    if (param.zodSchema.startsWith("z.object(")) {
      inputSchemaEntries.push(
        `      ${param.name}: ${param.zodSchema}${param.isOptional ? ".optional()" : ""}`
      );
      callArgs.push(`params.${param.name}`);
    } else {
      inputSchemaEntries.push(
        `      ${param.name}: ${param.zodSchema}${param.isOptional ? ".optional()" : ""}`
      );
      callArgs.push(`params.${param.name}`);
    }
  }

  // If there are no visible params, check if we only had context params
  // In that case, we still need to pass them through
  const hasVisibleParams = fn.params.some((p) => !p.isContextParam);

  // Build the handler
  const inputSchema =
    inputSchemaEntries.length > 0
      ? `{\n${inputSchemaEntries.join(",\n")},\n    }`
      : "{}";

  // Check if context params are embedded INSIDE an object parameter's type
  // (e.g., `payload: { id, companyId, userId }`) vs being separate positional params
  // (e.g., `(client, companyId, args)`). Only merge when context is inside the object.
  const objectParamsWithEmbeddedContext = fn.params.filter(
    (p) =>
      !p.isContextParam &&
      CONTEXT_PARAM_NAMES.some((cp) => p.tsType.includes(cp))
  );

  let handlerBody: string;

  if (objectParamsWithEmbeddedContext.length > 0) {
    // Context params live inside the object param — merge them in
    const objectParam = objectParamsWithEmbeddedContext[0];

    // Detect which context fields appear in the type annotation
    const embeddedContextFields: string[] = [];
    for (const cp of CONTEXT_PARAM_NAMES) {
      // Check for the field name in the type annotation (as a property, not substring)
      if (new RegExp(`\\b${cp}\\b`).test(objectParam.tsType)) {
        if (cp === "createdBy" || cp === "updatedBy") {
          embeddedContextFields.push(`${cp}: ctx.userId`);
        } else {
          embeddedContextFields.push(`${cp}: ctx.${cp}`);
        }
      }
    }

    // Also include any separate context params from callArgs
    const separateContextAssignments = fn.params
      .filter((p) => p.isContextParam)
      .map((p) => {
        if (p.name === "createdBy" || p.name === "updatedBy")
          return `${p.name}: ctx.userId`;
        return `${p.name}: ctx.${p.name}`;
      });

    const allContextAssignments = [
      ...new Set([...embeddedContextFields, ...separateContextAssignments]),
    ].join(", ");

    // Build call args, replacing the object param with the merged version
    const mergedCallArgs = callArgs.map((arg) =>
      arg === `params.${objectParam.name}`
        ? `{ ...params.${objectParam.name}, ${allContextAssignments} }`
        : arg
    );

    handlerBody = `      const result = await ${fn.name}(${mergedCallArgs.join(", ")});
      return toMcpResult(result);`;
  } else {
    handlerBody = `      const result = await ${fn.name}(${callArgs.join(", ")});
      return toMcpResult(result);`;
  }

  // Build description from function name
  const description = humanizeFunction(fn.name, moduleName);

  return `  server.registerTool(
    "${toolName}",
    {
      description: "${description}",
      inputSchema: ${inputSchema},
      annotations: ${annotation},
    },
    withErrorHandling(async (params) => {
${handlerBody}
    }, "Failed: ${toolName}"),
  );`;
}

function humanizeFunction(name: string, moduleName: string): string {
  // Split camelCase
  const words = name
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim()
    .split(" ");
  return words.join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Generate the barrel export (index.ts)
 */
function generateBarrelExport(modules: ModuleInfo[]): string {
  const imports = modules
    .map(
      (m) =>
        `export { register${capitalize(m.moduleName)}Tools } from "./${m.moduleName}";`
    )
    .join("\n");

  return `// @ts-nocheck
// AUTO-GENERATED by scripts/generate-mcp.ts — do not edit manually
${imports}
`;
}

/**
 * Generate the server.ts file
 */
function generateServerFile(modules: ModuleInfo[]): string {
  const imports = modules
    .map(
      (m) =>
        `  register${capitalize(m.moduleName)}Tools,`
    )
    .join("\n");

  const registrations = modules
    .map(
      (m) =>
        `  register${capitalize(m.moduleName)}Tools(server, ctx);`
    )
    .join("\n");

  const moduleDescriptions = modules
    .map((m) => {
      const readCount = m.functions.filter(
        (f) => f.classification === "READ"
      ).length;
      const writeCount = m.functions.filter(
        (f) => f.classification === "WRITE"
      ).length;
      const deleteCount = m.functions.filter(
        (f) => f.classification === "DESTRUCTIVE"
      ).length;
      return `- ${m.moduleName}_* — ${readCount} read, ${writeCount} write, ${deleteCount} delete tools`;
    })
    .join("\n");

  return `// @ts-nocheck
// AUTO-GENERATED by scripts/generate-mcp.ts — do not edit manually
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./types";
import {
${imports}
} from "./tools";

function getServerInstructions(): string {
  const today = new Date().toISOString().split("T")[0];

  return \`Carbon ERP is a manufacturing system. This MCP server provides access to ERP data including sales, purchasing, inventory, production, quality, and more.

## Current Date
Today is \${today}.

## Tool Organization
Tools are namespaced by module — use the prefix to discover related tools:
${moduleDescriptions}

## Key Patterns
- All monetary amounts use the company's base currency unless specified.
- Date parameters use ISO 8601 format (YYYY-MM-DD).
- List tools support pagination via limit/offset (GenericQueryFilters).
- companyId and userId are auto-filled from the authenticated context — do not provide them.
- Most get/list tools return { data, error, count? } — check error before using data.
- Tool errors return isError: true with a text explanation.
\`;
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    {
      name: "carbon-erp",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "1.0.0",
    },
    {
      instructions: getServerInstructions(),
    },
  );

${registrations}

  return server;
}
`;
}

/**
 * Generate documentation
 */
function generateDocs(modules: ModuleInfo[]): string {
  let totalTools = 0;
  const sections: string[] = [];

  for (const module of modules) {
    totalTools += module.functions.length;
    const lines: string[] = [
      `## ${module.moduleName} (${module.functions.length} tools)`,
      "",
    ];

    for (const fn of module.functions) {
      lines.push(
        `### ${module.moduleName}_${fn.name} (${fn.classification})`
      );
      lines.push(humanizeFunction(fn.name, module.moduleName));

      const visibleParams = fn.params.filter((p) => !p.isContextParam);
      if (visibleParams.length > 0) {
        lines.push("**Parameters:**");
        for (const param of visibleParams) {
          const opt = param.isOptional ? " (optional)" : "";
          lines.push(`- \`${param.name}\`: ${param.tsType}${opt}`);
        }
      } else {
        lines.push("**Parameters:** none (context auto-filled)");
      }
      lines.push("");
    }

    sections.push(lines.join("\n"));
  }

  return `# Carbon ERP MCP Tools Reference

> Auto-generated by scripts/generate-mcp.ts
> Total: ${totalTools} tools across ${modules.length} modules

${sections.join("\n---\n\n")}`;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("Initializing TypeScript project...");

  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "apps/erp/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  // Find all service files
  const serviceFiles = fs
    .readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      moduleName: d.name,
      servicePath: path.join(MODULES_DIR, d.name, `${d.name}.service.ts`),
      modelsPath: fs.existsSync(
        path.join(MODULES_DIR, d.name, `${d.name}.models.ts`)
      )
        ? path.join(MODULES_DIR, d.name, `${d.name}.models.ts`)
        : null,
    }))
    .filter((m) => {
      if (!fs.existsSync(m.servicePath)) {
        console.log(`  Skipping ${m.moduleName}: no service file`);
        return false;
      }
      // Skip the mcp module itself
      if (m.moduleName === "mcp") return false;
      return true;
    });

  console.log(`Found ${serviceFiles.length} service modules`);

  const modules: ModuleInfo[] = [];

  for (const sf of serviceFiles) {
    console.log(`  Parsing ${sf.moduleName}...`);
    try {
      const { functions, validatorSources } = extractFunctions(project, sf.servicePath, sf.moduleName);
      console.log(`    → ${functions.length} exported functions`);

      modules.push({
        moduleName: sf.moduleName,
        servicePath: sf.servicePath,
        modelsPath: sf.modelsPath,
        functions,
        validatorSources,
      });
    } catch (err) {
      console.error(`    ✗ Error parsing ${sf.moduleName}:`, err);
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  // Generate tool files
  console.log("\nGenerating tool files...");
  for (const module of modules) {
    if (module.functions.length === 0) {
      console.log(`  Skipping ${module.moduleName}: no functions`);
      continue;
    }

    const content = generateToolFile(module);
    const outPath = path.join(TOOLS_DIR, `${module.moduleName}.ts`);
    fs.writeFileSync(outPath, content);
    console.log(`  ✓ ${module.moduleName}.ts (${module.functions.length} tools)`);
  }

  // Generate barrel export
  const barrelContent = generateBarrelExport(
    modules.filter((m) => m.functions.length > 0)
  );
  fs.writeFileSync(path.join(TOOLS_DIR, "index.ts"), barrelContent);
  console.log("  ✓ index.ts (barrel export)");

  // Generate server.ts
  const serverContent = generateServerFile(
    modules.filter((m) => m.functions.length > 0)
  );
  fs.writeFileSync(path.join(MCP_LIB_DIR, "server.ts"), serverContent);
  console.log("  ✓ server.ts");

  // Generate docs
  console.log("\nGenerating documentation...");
  fs.mkdirSync(path.dirname(DOCS_PATH), { recursive: true });
  const docs = generateDocs(modules.filter((m) => m.functions.length > 0));
  fs.writeFileSync(DOCS_PATH, docs);
  console.log(`  ✓ ${path.relative(ROOT, DOCS_PATH)}`);

  const totalTools = modules.reduce((sum, m) => sum + m.functions.length, 0);
  console.log(`\nDone! Generated ${totalTools} tools across ${modules.length} modules.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
