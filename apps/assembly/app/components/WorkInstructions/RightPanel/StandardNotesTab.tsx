import { cn } from "@carbon/react";
import { useState } from "react";
import { BsChevronDown, BsChevronRight, BsX } from "react-icons/bs";
import type { AssemblyStep, StandardNote } from "~/types/assembly.types";

export interface StandardNotesTabProps {
  step?: AssemblyStep;
  standardNotes: StandardNote[];
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
}

export function StandardNotesTab({
  step,
  standardNotes,
  onStepUpdate
}: StandardNotesTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select a step to assign standard notes
      </div>
    );
  }

  const stepNoteIds = step.standardNoteIds || [];

  const filteredNotes = standardNotes.filter(
    (note) =>
      note.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group notes by category
  const notesByCategory = filteredNotes.reduce(
    (acc, note) => {
      const category = note.category || "General";
      if (!acc[category]) acc[category] = [];
      acc[category].push(note);
      return acc;
    },
    {} as Record<string, StandardNote[]>
  );

  const handleToggleNote = (noteId: string) => {
    const isAssigned = stepNoteIds.includes(noteId);
    if (isAssigned) {
      onStepUpdate?.(
        "standardNoteIds",
        stepNoteIds.filter((id) => id !== noteId)
      );
    } else {
      onStepUpdate?.("standardNoteIds", [...stepNoteIds, noteId]);
    }
  };

  const assignedNotes = standardNotes.filter((note) =>
    stepNoteIds.includes(note.id)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Assigned Standard Notes */}
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Assigned Standard Notes ({assignedNotes.length})
        </h3>
        {assignedNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No standard notes assigned
          </p>
        ) : (
          <ul className="space-y-1">
            {assignedNotes.map((note) => (
              <li
                key={note.id}
                className="flex items-start gap-2 text-sm p-2 rounded bg-primary/10 group"
              >
                <div className="flex-1">
                  <div className="font-medium text-primary">{note.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {note.content}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleNote(note.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <BsX />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Standard Notes Library */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Standard Notes Library
          </h3>
          <input
            type="text"
            placeholder="Search standard notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-muted/50 border border-border rounded px-2 py-1.5 placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {Object.entries(notesByCategory).map(([category, categoryNotes]) => (
            <div key={category} className="mb-4">
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                {category}
              </h4>
              <ul className="space-y-1">
                {categoryNotes.map((note) => {
                  const isAssigned = stepNoteIds.includes(note.id);
                  const isExpanded = expandedNoteId === note.id;

                  return (
                    <li
                      key={note.id}
                      className="rounded border border-border overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleNote(note.id)}
                        className={cn(
                          "w-full flex items-center gap-2 text-sm p-2 text-left transition-colors",
                          isAssigned ? "bg-primary/10" : "hover:bg-muted/50"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          readOnly
                          className="pointer-events-none"
                        />
                        <span className="flex-1 truncate font-medium">
                          {note.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedNoteId(isExpanded ? null : note.id);
                          }}
                          className="text-muted-foreground hover:text-foreground p-1"
                        >
                          {isExpanded ? <BsChevronDown /> : <BsChevronRight />}
                        </button>
                      </button>

                      {isExpanded && (
                        <div className="p-2 bg-muted/20 border-t border-border text-sm text-muted-foreground">
                          {note.content}
                          {note.usageCount > 0 && (
                            <div className="mt-2 text-xs">
                              Used {note.usageCount} time
                              {note.usageCount !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {filteredNotes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No standard notes found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
