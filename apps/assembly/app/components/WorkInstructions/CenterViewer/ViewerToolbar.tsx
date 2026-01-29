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
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
      {/* View Presets */}
      <div className="bg-card/90 backdrop-blur-sm rounded-lg border border-border shadow-lg p-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-2 py-1">
          Views
        </div>
        <div className="flex flex-wrap gap-0.5">
          {viewButtons.map((button) => (
            <button
              key={button.id}
              type="button"
              onClick={button.onClick}
              title={button.label}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded text-sm transition-colors",
                "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {button.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="bg-card/90 backdrop-blur-sm rounded-lg border border-border shadow-lg p-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-2 py-1">
          Tools
        </div>
        <div className="flex flex-col gap-0.5">
          {toolButtons.map((button) => (
            <button
              key={button.id}
              type="button"
              onClick={button.onClick}
              title={button.label}
              className={cn(
                "w-full px-2 py-1.5 flex items-center gap-2 rounded text-xs transition-colors",
                button.isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="w-4 text-center">{button.icon}</span>
              <span>{button.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
