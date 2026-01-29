import { useCallback, useEffect, useState } from "react";
import type { AssemblyStep } from "~/types/assembly.types";

export interface NotesTabProps {
  step?: AssemblyStep;
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
}

export function NotesTab({ step, onStepUpdate }: NotesTabProps) {
  const [localNotes, setLocalNotes] = useState(step?.notes || "");

  // Sync local state when step changes
  useEffect(() => {
    setLocalNotes(step?.notes || "");
  }, [step?.notes]);

  const handleNotesChange = useCallback((value: string) => {
    setLocalNotes(value);
  }, []);

  const handleNotesBlur = useCallback(() => {
    onStepUpdate?.("notes", localNotes);
  }, [localNotes, onStepUpdate]);

  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select a step to add notes
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col h-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Step Notes
      </h3>

      <p className="text-xs text-muted-foreground mb-3">
        Add specific notes for this assembly step. These will be shown to
        operators during assembly.
      </p>

      <textarea
        value={localNotes}
        onChange={(e) => handleNotesChange(e.target.value)}
        onBlur={handleNotesBlur}
        placeholder="Enter notes for this step...&#10;&#10;Examples:&#10;- Apply grease before installation&#10;- Check alignment before tightening&#10;- Use anti-seize on threads"
        className="flex-1 w-full text-sm bg-muted/30 border border-border rounded-md p-3 resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
        rows={10}
      />

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{localNotes.length} characters</span>
        <span>Markdown supported</span>
      </div>
    </div>
  );
}
