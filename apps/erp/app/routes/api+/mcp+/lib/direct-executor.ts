// Direct executor for ERP functions without MCP protocol wrapper

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountFunctions from "~/modules/account/account.service";
import * as accountingFunctions from "~/modules/accounting/accounting.service";
import * as documentsFunctions from "~/modules/documents/documents.service";
import * as inventoryFunctions from "~/modules/inventory/inventory.service";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service";
import * as itemsFunctions from "~/modules/items/items.service";
import * as peopleFunctions from "~/modules/people/people.service";
import * as productionFunctions from "~/modules/production/production.service";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service";
import * as qualityFunctions from "~/modules/quality/quality.service";
import * as resourcesFunctions from "~/modules/resources/resources.service";
import * as salesFunctions from "~/modules/sales/sales.service";
import * as settingsFunctions from "~/modules/settings/settings.service";
import * as sharedFunctions from "~/modules/shared/shared.service";
import * as usersFunctions from "~/modules/users/users.service";
import { isMcpBlockedTool } from "./mcp-blocked-tools";

// Combine all functions into a single registry
const functionRegistry = {
  account: accountFunctions,
  accounting: accountingFunctions,
  documents: documentsFunctions,
  inventory: inventoryFunctions,
  invoicing: invoicingFunctions,
  items: itemsFunctions,
  people: peopleFunctions,
  production: productionFunctions,
  purchasing: purchasingFunctions,
  quality: qualityFunctions,
  resources: resourcesFunctions,
  sales: salesFunctions,
  settings: settingsFunctions,
  shared: sharedFunctions,
  users: usersFunctions
};

export interface ExecutorContext {
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
}

export async function executeFunction(
  functionName: string,
  context: ExecutorContext,
  args?: Record<string, any> | string
) {
  if (typeof args === "string") {
    try {
      args = args.trim().length > 0 ? JSON.parse(args) : {};
    } catch {
      return {
        success: false,
        error: "Invalid JSON arguments"
      };
    }
  }
  const normalizedArgs = args && typeof args === "object" ? args : undefined;

  console.log("[DirectExecutor] Executing function:", functionName);
  console.log(
    "[DirectExecutor] Args:",
    JSON.stringify(normalizedArgs, null, 2)
  );
  console.log("[DirectExecutor] Context:", {
    companyId: context.companyId,
    userId: context.userId
  });

  if (isMcpBlockedTool(functionName)) {
    return {
      success: false,
      error: `Tool disabled: ${functionName} is not available via MCP.`
    };
  }

  // Parse the function name to get module and function
  const parts = functionName.split("_");
  if (parts.length < 2) {
    console.error(
      "[DirectExecutor] Invalid function name format:",
      functionName
    );
    throw new Error(`Invalid function name format: ${functionName}`);
  }

  const moduleName = parts[0];
  const funcName = parts.slice(1).join("_");
  console.log("[DirectExecutor] Module:", moduleName, "Function:", funcName);

  // Get the module functions
  const moduleFunctions =
    functionRegistry[moduleName as keyof typeof functionRegistry];
  if (!moduleFunctions) {
    console.error("[DirectExecutor] Module not found:", moduleName);
    console.log(
      "[DirectExecutor] Available modules:",
      Object.keys(functionRegistry)
    );
    throw new Error(`Module not found: ${moduleName}`);
  }

  // Get the specific function
  const func = moduleFunctions[funcName as keyof typeof moduleFunctions];
  if (!func || typeof func !== "function") {
    console.error(
      "[DirectExecutor] Function not found:",
      funcName,
      "in module",
      moduleName
    );
    console.log(
      "[DirectExecutor] Available functions in module:",
      Object.keys(moduleFunctions)
    );
    throw new Error(`Function not found: ${funcName} in module ${moduleName}`);
  }
  console.log("[DirectExecutor] Function found successfully");

  try {
    // Get function parameter names by converting to string and parsing
    const funcString = (func as Function).toString();
    const paramMatch = funcString.match(/\(([^)]*)\)/);
    const paramNames =
      paramMatch?.[1]
        ?.split(",")
        ?.map((p: string) => p.trim().split(/[=\s]/)[0])
        ?.filter((p: string) => p) || [];

    console.log("[DirectExecutor] Function parameters:", paramNames);

    // Build arguments array based on parameter names
    const functionArgs: any[] = [];

    for (const paramName of paramNames) {
      if (paramName === "client") {
        functionArgs.push(context.client);
        console.log("[DirectExecutor] Added client to args");
      } else if (paramName === "userId") {
        const userIdValue = normalizedArgs?.userId || context.userId;
        functionArgs.push(userIdValue);
        console.log("[DirectExecutor] Added userId to args:", userIdValue);
      } else if (paramName === "companyId") {
        const companyIdValue = normalizedArgs?.companyId || context.companyId;
        functionArgs.push(companyIdValue);
        console.log(
          "[DirectExecutor] Added companyId to args:",
          companyIdValue
        );
      } else if (paramName === "args") {
        // For 'args' parameter, pass the entire args object or a default
        // This is the parameter that most service functions expect
        const argsValue = normalizedArgs || {};
        functionArgs.push(argsValue);
        console.log(
          "[DirectExecutor] Added args object:",
          JSON.stringify(argsValue, null, 2)
        );
      } else if (normalizedArgs && paramName in normalizedArgs) {
        functionArgs.push(normalizedArgs[paramName]);
        console.log(
          `[DirectExecutor] Added ${paramName} from args:`,
          normalizedArgs[paramName]
        );
      } else if (
        normalizedArgs &&
        Object.keys(normalizedArgs).length === 1 &&
        !paramNames.some((p: string) => p in normalizedArgs)
      ) {
        // If single arg that doesn't match param names, use it as positional
        const value = Object.values(normalizedArgs)[0];
        functionArgs.push(value);
        console.log("[DirectExecutor] Added single positional arg:", value);
      } else {
        // Skip optional parameters
        console.log(
          `[DirectExecutor] Skipping optional parameter: ${paramName}`
        );
        continue;
      }
    }

    console.log(
      "[DirectExecutor] Calling function with args:",
      functionArgs.length,
      "arguments"
    );
    // Don't log the client object as it causes circular reference
    const loggableArgs = functionArgs.map((arg, i) => {
      if (paramNames[i] === "client") return "[SupabaseClient]";
      return arg;
    });
    console.log(
      "[DirectExecutor] Actual args being passed:",
      JSON.stringify(loggableArgs, null, 2)
    );

    // Execute the function
    let result = await (func as Function)(...functionArgs);

    console.log("[DirectExecutor] Function executed successfully");
    console.log("[DirectExecutor] Raw result type:", typeof result);

    // Check if result is a Supabase query builder (it's thenable but not yet executed)
    // Supabase queries are thenable objects that need to be awaited
    if (
      result &&
      typeof result === "object" &&
      typeof result.then === "function"
    ) {
      console.log(
        "[DirectExecutor] Result is thenable (likely Supabase query), awaiting execution..."
      );
      try {
        const executedResult = await result;
        console.log("[DirectExecutor] Query executed successfully");
        console.log(
          "[DirectExecutor] Executed result type:",
          typeof executedResult
        );
        if (executedResult && typeof executedResult === "object") {
          console.log(
            "[DirectExecutor] Result has keys:",
            Object.keys(executedResult)
          );
          if ("data" in executedResult) {
            console.log(
              "[DirectExecutor] Result has data property, length:",
              Array.isArray(executedResult.data)
                ? executedResult.data.length
                : "not array"
            );
          }
          if ("error" in executedResult) {
            console.log(
              "[DirectExecutor] Result has error:",
              executedResult.error
            );
          }
          if ("count" in executedResult) {
            console.log("[DirectExecutor] Result count:", executedResult.count);
          }
        }
        result = executedResult;
      } catch (queryError: any) {
        console.error("[DirectExecutor] Query execution failed:", queryError);
        throw queryError;
      }
    }

    // Log result safely
    try {
      const resultPreview = JSON.stringify(result, null, 2).substring(0, 500);
      console.log("[DirectExecutor] Final result preview:", resultPreview);
    } catch (_e) {
      console.log(
        "[DirectExecutor] Could not stringify result, likely contains circular references"
      );
      console.log(
        "[DirectExecutor] Result keys:",
        result && typeof result === "object" ? Object.keys(result) : "N/A"
      );
    }

    return {
      success: true,
      data: result
    };
  } catch (error: any) {
    console.error("[DirectExecutor] Function execution failed:", error);
    console.error("[DirectExecutor] Error stack:", error.stack);
    return {
      success: false,
      error: error.message || "Function execution failed"
    };
  }
}

// Helper to search available functions
export function searchFunctions(query?: string, module?: string): string[] {
  const results: string[] = [];

  Object.entries(functionRegistry).forEach(([moduleName, functions]) => {
    if (module && moduleName !== module) return;

    Object.keys(functions).forEach((funcName) => {
      const fullName = `${moduleName}_${funcName}`;
      if (isMcpBlockedTool(fullName)) return;
      if (!query || fullName.toLowerCase().includes(query.toLowerCase())) {
        results.push(fullName);
      }
    });
  });

  return results;
}
