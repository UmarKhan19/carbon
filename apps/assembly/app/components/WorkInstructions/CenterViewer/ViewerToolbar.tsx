import { cn } from "@carbon/react";

export interface ViewerToolbarProps {
  onFitToView: () => void;
  onSetView: (
    preset: "front" | "back" | "top" | "bottom" | "left" | "right" | "iso"
  ) => void;
  onToggleExploded: () => void;
  isExploded: boolean;
  onToggleSectionPlane?: () => void;
  isSectionPlaneActive?: boolean;
  onToggleMeasure?: () => void;
  isMeasureActive?: boolean;
}

interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  isActive?: boolean;
}

export function ViewerToolbar({
  onFitToView,
  onSetView,
  onToggleExploded,
  isExploded,
  onToggleSectionPlane,
  isSectionPlaneActive,
  onToggleMeasure,
  isMeasureActive
}: ViewerToolbarProps) {
  const viewButtons: ToolbarButton[] = [
    {
      id: "front",
      label: "Front",
      icon: "▢",
      onClick: () => onSetView("front")
    },
    { id: "back", label: "Back", icon: "▣", onClick: () => onSetView("back") },
    { id: "top", label: "Top", icon: "⬓", onClick: () => onSetView("top") },
    { id: "left", label: "Left", icon: "◧", onClick: () => onSetView("left") },
    {
      id: "right",
      label: "Right",
      icon: "◨",
      onClick: () => onSetView("right")
    },
    { id: "iso", label: "Iso", icon: "◇", onClick: () => onSetView("iso") }
  ];

  const toolButtons: ToolbarButton[] = [
    { id: "fit", label: "Fit", icon: "⊡", onClick: onFitToView },
    {
      id: "explode",
      label: "Explode",
      icon: "✦",
      onClick: onToggleExploded,
      isActive: isExploded
    },
    ...(onToggleSectionPlane
      ? [
          {
            id: "section",
            label: "Section",
            icon: "◫",
            onClick: onToggleSectionPlane,
            isActive: isSectionPlaneActive
          }
        ]
      : []),
    ...(onToggleMeasure
      ? [
          {
            id: "measure",
            label: "Measure",
            icon: "↔",
            onClick: onToggleMeasure,
            isActive: isMeasureActive
          }
        ]
      : [])
  ];

  return (
    <div className="absolute top-2 left-2 z-10">
      <div className="bg-card border border-border rounded-md shadow-sm p-0.5 flex flex-col">
        {/* View Presets */}
        {viewButtons.map((button) => (
          <button
            key={button.id}
            type="button"
            onClick={button.onClick}
            title={button.label}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded text-xs transition-colors",
              "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {button.icon}
          </button>
        ))}

        {/* Divider */}
        <div className="h-px bg-border mx-1 my-0.5" />

        {/* Tools */}
        {toolButtons.map((button) => (
          <button
            key={button.id}
            type="button"
            onClick={button.onClick}
            title={button.label}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded text-xs transition-colors",
              button.isActive
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {button.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
