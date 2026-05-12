import { Button, cn } from "@carbon/react";
import { LuX } from "react-icons/lu";

type NavigationEditBarProps = {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
};

export function NavigationEditBar({
  isSaving,
  isDirty,
  onSave,
  onCancel
}: NavigationEditBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-2 py-2",
        "bg-primary text-primary-foreground",
        "rounded-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">Customize</span>
        <button
          type="button"
          onClick={onCancel}
          className="p-0.5 rounded hover:bg-primary-foreground/20"
        >
          <LuX className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 h-7 text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="flex-1 h-7 text-xs"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
