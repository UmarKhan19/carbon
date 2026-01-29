import { cn } from "@carbon/react";
import { useState } from "react";
import type { AssemblyStep, StepTool, Tool } from "~/types/assembly.types";

export interface ToolsTabProps {
  step?: AssemblyStep;
  allTools: Tool[];
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
}

export function ToolsTab({ step, allTools, onStepUpdate }: ToolsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select a step to manage tools
      </div>
    );
  }

  const stepTools = step.tools || [];
  const stepToolIds = stepTools.map((t) => t.toolId);

  const filteredTools = allTools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddTool = (tool: Tool) => {
    if (stepToolIds.includes(tool.id)) return;

    const newStepTool: StepTool = {
      toolId: tool.id,
      name: tool.name,
      category: tool.category,
      imageUrl: tool.imageUrl,
      quantity: 1
    };

    onStepUpdate?.("tools", [...stepTools, newStepTool]);
  };

  const handleRemoveTool = (toolId: string) => {
    onStepUpdate?.(
      "tools",
      stepTools.filter((t) => t.toolId !== toolId)
    );
  };

  const handleQuantityChange = (toolId: string, quantity: number) => {
    onStepUpdate?.(
      "tools",
      stepTools.map((t) =>
        t.toolId === toolId ? { ...t, quantity: Math.max(1, quantity) } : t
      )
    );
  };

  // Group tools by category
  const toolsByCategory = filteredTools.reduce(
    (acc, tool) => {
      const category = tool.category || "Uncategorized";
      if (!acc[category]) acc[category] = [];
      acc[category].push(tool);
      return acc;
    },
    {} as Record<string, Tool[]>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Assigned Tools */}
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Assigned Tools ({stepTools.length})
        </h3>
        {stepTools.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No tools assigned to this step
          </p>
        ) : (
          <ul className="space-y-1">
            {stepTools.map((tool) => (
              <li
                key={tool.toolId}
                className="flex items-center gap-2 text-sm p-1.5 rounded bg-muted/30 group"
              >
                {tool.imageUrl ? (
                  <img
                    src={tool.imageUrl}
                    alt={tool.name}
                    className="w-8 h-8 object-contain rounded"
                  />
                ) : (
                  <div className="w-8 h-8 bg-muted rounded flex items-center justify-center">
                    🔧
                  </div>
                )}
                <span className="flex-1 truncate">{tool.name}</span>
                <input
                  type="number"
                  min={1}
                  value={tool.quantity || 1}
                  onChange={(e) =>
                    handleQuantityChange(
                      tool.toolId,
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="w-12 text-center text-xs bg-background border border-border rounded px-1 py-0.5"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveTool(tool.toolId)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tool Library */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Tool Library
          </h3>
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-muted/50 border border-border rounded px-2 py-1.5 placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {Object.entries(toolsByCategory).map(([category, categoryTools]) => (
            <div key={category} className="mb-4">
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                {category}
              </h4>
              <ul className="space-y-1">
                {categoryTools.map((tool) => {
                  const isAssigned = stepToolIds.includes(tool.id);
                  return (
                    <li key={tool.id}>
                      <button
                        type="button"
                        onClick={() => handleAddTool(tool)}
                        disabled={isAssigned}
                        className={cn(
                          "w-full flex items-center gap-2 text-sm p-1.5 rounded text-left transition-colors",
                          isAssigned
                            ? "bg-primary/10 text-primary cursor-default"
                            : "hover:bg-muted/50"
                        )}
                      >
                        {tool.imageUrl ? (
                          <img
                            src={tool.imageUrl}
                            alt={tool.name}
                            className="w-6 h-6 object-contain rounded"
                          />
                        ) : (
                          <div className="w-6 h-6 bg-muted rounded flex items-center justify-center text-xs">
                            🔧
                          </div>
                        )}
                        <span className="flex-1 truncate">{tool.name}</span>
                        {isAssigned && (
                          <span className="text-xs text-primary">✓</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {filteredTools.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tools found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
