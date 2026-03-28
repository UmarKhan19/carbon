import type { ToolConfig } from "../agents/shared/tools";

// Dynamically import all tool configs from sibling files
// Exclude config.ts itself to avoid circular imports
const toolModules = import.meta.glob(["./*.ts", "!./*.server.ts"], {
  eager: true
}) as Record<string, { config: ToolConfig }>;

// Create the config object from imported tool modules
export const toolConfigs: Record<
  string,
  Pick<ToolConfig, "icon" | "displayText" | "message">
> = Object.entries(toolModules).reduce(
  (acc, [path, module]) => {
    // Skip config.ts itself to avoid circular imports
    if (path.includes("config.ts")) return acc;

    if (module.config) {
      acc[module.config.name] = {
        icon: module.config.icon,
        displayText: module.config.displayText,
        message: module.config.message
      };
    }
    return acc;
  },
  {} as Record<string, Pick<ToolConfig, "icon" | "displayText" | "message">>
);
