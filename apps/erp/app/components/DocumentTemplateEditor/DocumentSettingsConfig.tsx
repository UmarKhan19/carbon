import { ToggleRow } from "./configHelpers";
import { useDocumentTemplate } from "./context";

/** Document-wide visual settings (currently just the watermark toggle). */
export function DocumentSettingsConfig() {
  const { settings, setSetting } = useDocumentTemplate();
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Show watermark"
        checked={settings.showWatermark ?? true}
        onChange={(v) => setSetting("showWatermark", v)}
      />
      <p className="text-xs text-muted-foreground">
        Renders your watermark logo (set in Logos) faintly behind the document.
      </p>
    </div>
  );
}
