import { cn } from "@carbon/react";
import type { AssemblyStep, StandardNote, Tool } from "~/types/assembly.types";
import { MediaTab } from "./MediaTab";
import { NotesTab } from "./NotesTab";
import { StandardNotesTab } from "./StandardNotesTab";
import { SupplementsTab } from "./SupplementsTab";
import { ToolsTab } from "./ToolsTab";

export type RightPanelTab =
  | "supplements"
  | "tools"
  | "notes"
  | "standardNotes"
  | "media";

export interface RightPanelProps {
  step?: AssemblyStep;
  tools: Tool[];
  standardNotes: StandardNote[];
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
}

const tabs: { id: RightPanelTab; label: string; icon: string }[] = [
  { id: "supplements", label: "★", icon: "★" },
  { id: "tools", label: "Tools", icon: "🔧" },
  { id: "notes", label: "Notes", icon: "📝" },
  { id: "standardNotes", label: "Std Notes", icon: "📋" },
  { id: "media", label: "Media", icon: "🖼️" }
];

export function RightPanel({
  step,
  tools,
  standardNotes,
  activeTab,
  onTabChange,
  onStepUpdate
}: RightPanelProps) {
  return (
    <div className="w-80 bg-card border-l border-border flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex border-b border-border bg-muted/30">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex-1 px-2 py-2 text-xs font-medium transition-colors",
              "hover:bg-muted/50",
              activeTab === tab.id
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground"
            )}
          >
            {tab.id === "supplements" ? tab.icon : tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "supplements" && (
          <SupplementsTab
            step={step}
            tools={tools}
            standardNotes={standardNotes}
            onStepUpdate={onStepUpdate}
          />
        )}
        {activeTab === "tools" && (
          <ToolsTab step={step} allTools={tools} onStepUpdate={onStepUpdate} />
        )}
        {activeTab === "notes" && (
          <NotesTab step={step} onStepUpdate={onStepUpdate} />
        )}
        {activeTab === "standardNotes" && (
          <StandardNotesTab
            step={step}
            standardNotes={standardNotes}
            onStepUpdate={onStepUpdate}
          />
        )}
        {activeTab === "media" && (
          <MediaTab step={step} onStepUpdate={onStepUpdate} />
        )}
      </div>
    </div>
  );
}
