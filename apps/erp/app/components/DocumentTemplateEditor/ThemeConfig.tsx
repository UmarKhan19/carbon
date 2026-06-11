import type { DocumentTheme } from "@carbon/documents/template";
import { ColorPicker } from "~/components/ColorPicker";
import { useDocumentTemplate } from "./context";

const SWATCHES: { key: keyof DocumentTheme; label: string; hint: string }[] = [
  { key: "accent", label: "Accent", hint: "Table header bar, headings" },
  { key: "accentForeground", label: "Accent text", hint: "Text on the accent" }
];

export function ThemeConfig() {
  const { theme, setThemeColor } = useDocumentTemplate();

  return (
    <div className="flex flex-col gap-3">
      {SWATCHES.map(({ key, label, hint }) => (
        <div key={key} className="flex flex-col gap-1.5">
          <div className="flex flex-col">
            <span className="text-sm">{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </div>
          <ColorPicker
            value={theme[key]}
            onChange={(value) => setThemeColor(key, value)}
          />
        </div>
      ))}
    </div>
  );
}
