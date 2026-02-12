import { cn } from "@carbon/react";
import { BsWrench } from "react-icons/bs";
import type { AssemblyStep, StandardNote, Tool } from "~/types/assembly.types";

export interface SupplementsTabProps {
  step?: AssemblyStep;
  tools: Tool[];
  standardNotes: StandardNote[];
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
}

export function SupplementsTab({
  step,
  tools,
  standardNotes
}: SupplementsTabProps) {
  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select a step to view supplements
      </div>
    );
  }

  const stepTools = step.tools || [];
  const stepWarnings = step.warnings || [];
  const stepStandardNoteIds = step.standardNoteIds || [];
  const stepMediaIds = step.mediaIds || [];

  const linkedStandardNotes = standardNotes.filter((note) =>
    stepStandardNoteIds.includes(note.id)
  );

  return (
    <div className="p-3 space-y-4">
      {/* Tools Section */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
          <span>Tools</span>
          {stepTools.length > 0 && (
            <span className="bg-muted px-1.5 py-0.5 rounded text-xs">
              {stepTools.length}
            </span>
          )}
        </h3>
        {stepTools.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No tools assigned
          </p>
        ) : (
          <ul className="space-y-1">
            {stepTools.map((tool, index) => (
              <li
                key={tool.toolId || index}
                className="flex items-center gap-2 text-sm p-1.5 rounded hover:bg-muted/50"
              >
                {tool.imageUrl ? (
                  <img
                    src={tool.imageUrl}
                    alt={tool.name}
                    className="w-6 h-6 object-contain rounded"
                  />
                ) : (
                  <div className="w-6 h-6 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
                    <BsWrench />
                  </div>
                )}
                <span className="flex-1 truncate">{tool.name}</span>
                {tool.quantity && tool.quantity > 1 && (
                  <span className="text-xs text-muted-foreground">
                    x{tool.quantity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Warnings Section */}
      {stepWarnings.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Warnings
          </h3>
          <ul className="space-y-1">
            {stepWarnings.map((warning, index) => (
              <li
                key={index}
                className={cn(
                  "text-sm p-2 rounded border",
                  warning.type === "safety" &&
                    "bg-red-500/10 border-red-500/30 text-red-400",
                  warning.type === "quality" &&
                    "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
                  warning.type === "caution" &&
                    "bg-orange-500/10 border-orange-500/30 text-orange-400",
                  warning.type === "info" &&
                    "bg-blue-500/10 border-blue-500/30 text-blue-400"
                )}
              >
                <span className="font-medium capitalize">{warning.type}: </span>
                {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notes Preview */}
      {step.notes && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Notes
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-3">
            {step.notes}
          </p>
        </section>
      )}

      {/* Standard Notes Preview */}
      {linkedStandardNotes.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Standard Notes
          </h3>
          <ul className="space-y-1">
            {linkedStandardNotes.map((note) => (
              <li
                key={note.id}
                className="text-sm p-1.5 rounded bg-muted/30 hover:bg-muted/50"
              >
                <span className="font-medium">{note.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Media Preview */}
      {stepMediaIds.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Media
          </h3>
          <p className="text-sm text-muted-foreground">
            {stepMediaIds.length} attachment
            {stepMediaIds.length !== 1 ? "s" : ""}
          </p>
        </section>
      )}
    </div>
  );
}
