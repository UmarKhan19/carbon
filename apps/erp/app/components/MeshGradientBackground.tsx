import { cn, useMode } from "@carbon/react";
import { resolveTheme } from "@carbon/utils";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { useTheme } from "~/hooks/useTheme";

// Theme-aware Paper Shaders mesh-gradient backdrop. Used behind the onboarding
// flow and the Implementation Hub so both share the same soft, animated canvas.
const meshColorsByTheme: Record<
  string,
  {
    light: [string, string, string, string];
    dark: [string, string, string, string];
  }
> = {
  zinc: {
    light: ["#ededed", "#f3f3f3", "#fcfcfc", "#eeeeee"],
    dark: ["#131313", "#000000", "#070707", "#010101"]
  },
  neutral: {
    light: ["#ededed", "#f3f3f3", "#fcfcfc", "#eeeeee"],
    dark: ["#131313", "#000000", "#070707", "#010101"]
  },
  red: {
    light: ["#f5eae8", "#fcf1ef", "#fffbfa", "#f6ecea"],
    dark: ["#200c0a", "#000000", "#130302", "#060000"]
  },
  orange: {
    light: ["#f4ebe6", "#fbf1ed", "#fffbf9", "#f6ece8"],
    dark: ["#1f0d05", "#000000", "#120300", "#060000"]
  },
  yellow: {
    light: ["#f0ede4", "#f6f3eb", "#fdfcf8", "#f1eee6"],
    dark: ["#181201", "#000000", "#0c0700", "#030100"]
  },
  green: {
    light: ["#e6efeb", "#ecf6f1", "#f9fdfb", "#e8f1ec"],
    dark: ["#02170f", "#000000", "#000b05", "#000301"]
  },
  blue: {
    light: ["#e7eef5", "#eef4fb", "#f9fcff", "#e9eff6"],
    dark: ["#061422", "#000000", "#000815", "#000108"]
  },
  violet: {
    light: ["#eeebf4", "#f4f2fb", "#fcfbff", "#efedf6"],
    dark: ["#150f20", "#000000", "#090413", "#020007"]
  }
};

export function getMeshColors(theme: string, mode: string) {
  const name = resolveTheme(theme)?.name ?? "zinc";
  const colors = meshColorsByTheme[name] ?? meshColorsByTheme.zinc;
  return mode === "light" ? colors.light : colors.dark;
}

export function getMeshBackgroundGradient(theme: string, mode: string) {
  const colors = getMeshColors(theme, mode);
  return `linear-gradient(to bottom right, ${colors[1]} 35.67%, ${colors[0]} 88.95%)`;
}

// Absolute-positioned background layer. Parent must be `relative`; render real
// content as a sibling with `relative z-10` on top.
export function MeshGradientBackground({
  className,
  theme: themeOverride,
  darkOnly = false
}: {
  className?: string;
  // Force a fixed palette (e.g. "blue") instead of the company theme. By default
  // the mesh follows the company's chosen theme — both the signup onboarding flow
  // and the Implementation Hub leave this unset so they match the company theme.
  theme?: string;
  // Skip the gradient in light mode (the Implementation Hub renders on the plain
  // page background there); the signup onboarding flow keeps it in both modes.
  darkOnly?: boolean;
}) {
  const mode = useMode();
  const serverTheme = useTheme();
  const [theme, setTheme] = useState(serverTheme);

  useEffect(() => {
    setTheme(serverTheme);
  }, [serverTheme]);

  // The onboarding theme step dispatches this to preview themes live.
  useEffect(() => {
    const handler = (e: Event) => {
      setTheme((e as CustomEvent<string>).detail);
    };
    window.addEventListener("onboarding-theme-change", handler);
    return () => window.removeEventListener("onboarding-theme-change", handler);
  }, []);

  const activeTheme = themeOverride ?? theme;

  if (darkOnly && mode !== "dark") {
    return null;
  }

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{ background: getMeshBackgroundGradient(activeTheme, mode) }}
    >
      <MeshGradient
        speed={0.3}
        colors={getMeshColors(activeTheme, mode)}
        distortion={0.4}
        swirl={0.05}
        grainMixer={0}
        grainOverlay={0}
        className="absolute inset-0 w-full h-full"
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
