import { Switch } from "@carbon/react";
import { useDocumentTemplate } from "./context";

/** Document-wide visual settings (currently just the watermark toggle). */
export function DocumentSettingsConfig() {
  const { settings, setSetting, hasWatermark } = useDocumentTemplate();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={hasWatermark ? "text-sm" : "text-sm opacity-50"}>
          Show watermark
        </span>
        <Switch
          variant="small"
          disabled={!hasWatermark}
          checked={hasWatermark && (settings.showWatermark ?? true)}
          onCheckedChange={(v) => setSetting("showWatermark", Boolean(v))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {hasWatermark
          ? "Renders your watermark logo (set in Logos) faintly behind the document."
          : "Upload a watermark logo in Logos to enable this."}
      </p>
    </div>
  );
}
