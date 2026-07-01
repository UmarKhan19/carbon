/**
 * OKLCH color system + theme engine.
 *
 * Every theme is generated from a compact spec (brand hue + chroma + kind) by
 * `buildTheme`, which emits full `oklch(...)` strings for all semantic tokens in
 * both light and dark modes. Dark mode follows a perceptual-lightness formula
 * rather than hand-picked values.
 *
 * Token values are complete color strings (not bare HSL triplets), so every
 * consumer references them directly as `var(--token)` — never `hsl(var(--token))`.
 */

type Mode = "light" | "dark";
type ThemeKind = "accent" | "neutral" | "acid";

const ok = (l: number, c: number, h: number) =>
  `oklch(${+l.toFixed(4)} ${+c.toFixed(4)} ${h})`;

/** Fixed, non-rotating status hues (semantic identity is stable across themes). */
const STATUS = {
  destructive: 25,
  success: 160,
  warning: 80,
  info: 240
} as const;

/** Fixed, categorical chart hues at constant lightness (data identity is stable). */
const CHART_HUES = [25, 160, 240, 80, 300, 50] as const;

export type ThemeSpec = {
  name: string;
  label: string;
  /** Brand hue in OKLCH degrees. */
  hue: number;
  /** Brand chroma (0 = achromatic graphite). */
  chroma: number;
  kind: ThemeKind;
};

type CssVars = Record<string, string>;

type BrandVars = {
  primary: string;
  "primary-foreground": string;
  active: string;
  "active-foreground": string;
  ring: string;
};

function statusTokens(mode: Mode): CssVars {
  if (mode === "light") {
    return {
      destructive: ok(0.55, 0.16, STATUS.destructive),
      "destructive-foreground": ok(0.98, 0.02, STATUS.destructive),
      success: ok(0.55, 0.14, STATUS.success),
      "success-foreground": ok(0.98, 0.02, STATUS.success),
      warning: ok(0.68, 0.14, STATUS.warning),
      "warning-foreground": ok(0.26, 0.06, STATUS.warning),
      info: ok(0.55, 0.13, STATUS.info),
      "info-foreground": ok(0.98, 0.02, STATUS.info)
    };
  }
  return {
    destructive: ok(0.62, 0.15, STATUS.destructive),
    "destructive-foreground": ok(0.14, 0.02, STATUS.destructive),
    success: ok(0.62, 0.13, STATUS.success),
    "success-foreground": ok(0.14, 0.02, STATUS.success),
    warning: ok(0.72, 0.13, STATUS.warning),
    "warning-foreground": ok(0.18, 0.04, STATUS.warning),
    info: ok(0.62, 0.11, STATUS.info),
    "info-foreground": ok(0.14, 0.02, STATUS.info)
  };
}

function chartTokens(mode: Mode): CssVars {
  const l = mode === "light" ? 0.6 : 0.7;
  const chroma =
    mode === "light"
      ? [0.16, 0.14, 0.12, 0.13, 0.12, 0.14]
      : [0.14, 0.12, 0.1, 0.11, 0.1, 0.12];
  return CHART_HUES.reduce<CssVars>((acc, hue, i) => {
    acc[`chart-${i + 1}`] = ok(l, chroma[i] ?? 0.12, hue);
    return acc;
  }, {});
}

/** Brand-derived tokens: primary, active, ring. */
function brandTokens(spec: ThemeSpec, mode: Mode): BrandVars {
  const { hue: h, chroma: c, kind } = spec;
  const nh = h; // neutrals carry a faint brand tint

  if (kind === "neutral") {
    // Achromatic near-fg primary (graphite / brutal look).
    if (mode === "light") {
      return {
        primary: ok(0.24, c, nh),
        "primary-foreground": ok(0.98, 0, 0),
        active: ok(0.92, c, nh),
        "active-foreground": ok(0.28, c, nh),
        ring: ok(0.35, c, nh)
      };
    }
    return {
      primary: ok(0.93, c, nh),
      "primary-foreground": ok(0.14, c, nh),
      active: ok(0.22, c, nh),
      "active-foreground": ok(0.92, c, nh),
      ring: ok(0.55, c, nh)
    };
  }

  if (kind === "acid") {
    // High-lightness electric accent on graphite (Signal Acid).
    if (mode === "light") {
      return {
        primary: ok(0.82, c, h),
        "primary-foreground": ok(0.28, c * 0.5, h),
        active: ok(0.94, c * 0.5, h),
        "active-foreground": ok(0.4, c * 0.65, h),
        ring: ok(0.82, c, h)
      };
    }
    return {
      primary: ok(0.85, c, h),
      "primary-foreground": ok(0.24, c * 0.55, h),
      active: ok(0.28, c * 0.45, h),
      "active-foreground": ok(0.85, c * 0.75, h),
      ring: ok(0.85, c, h)
    };
  }

  // Standard colored accent.
  if (mode === "light") {
    return {
      primary: ok(0.52, c, h),
      "primary-foreground": ok(0.98, c * 0.05, h),
      active: ok(0.93, c * 0.25, h),
      "active-foreground": ok(0.4, c * 0.8, h),
      ring: ok(0.52, c, h)
    };
  }
  return {
    primary: ok(0.72, c * 0.85, h),
    "primary-foreground": ok(0.14, c * 0.15, h),
    active: ok(0.24, c * 0.35, h),
    "active-foreground": ok(0.8, c * 0.75, h),
    ring: ok(0.72, c * 0.85, h)
  };
}

/** Neutral surfaces, text, borders — faintly tinted with the brand hue. */
function neutralTokens(spec: ThemeSpec, mode: Mode): CssVars {
  const nh = spec.hue;
  const nc = spec.kind === "neutral" ? 0.004 : 0.006;

  if (mode === "light") {
    return {
      background: ok(1, 0, 0),
      foreground: ok(0.16, nc, nh),
      card: ok(0.99, nc, nh),
      "card-foreground": ok(0.16, nc, nh),
      popover: ok(0.985, nc, nh),
      "popover-foreground": ok(0.16, nc, nh),
      secondary: ok(0.95, nc, nh),
      "secondary-foreground": ok(0.24, nc, nh),
      muted: ok(0.95, nc, nh),
      "muted-foreground": ok(0.55, nc, nh),
      accent: ok(0.955, nc, nh),
      "accent-foreground": ok(0.24, nc, nh),
      border: ok(0.9, nc, nh),
      input: ok(0.9, nc, nh)
    };
  }
  return {
    background: ok(0.08, nc, nh),
    foreground: ok(0.93, nc, nh),
    card: ok(0.12, nc, nh),
    "card-foreground": ok(0.93, nc, nh),
    popover: ok(0.15, nc, nh),
    "popover-foreground": ok(0.93, nc, nh),
    secondary: ok(0.18, nc, nh),
    "secondary-foreground": ok(0.92, nc, nh),
    muted: ok(0.2, nc, nh),
    "muted-foreground": ok(0.62, nc, nh),
    accent: ok(0.18, nc, nh),
    "accent-foreground": ok(0.92, nc, nh),
    border: ok(0.25, nc, nh),
    input: ok(0.25, nc, nh)
  };
}

/** Sidebar surfaces derived from the neutral + brand ramp. */
function sidebarTokens(spec: ThemeSpec, mode: Mode, brand: BrandVars): CssVars {
  const nh = spec.hue;
  const nc = spec.kind === "neutral" ? 0.004 : 0.006;
  if (mode === "light") {
    return {
      "sidebar-background": ok(0.985, nc, nh),
      "sidebar-foreground": ok(0.35, nc, nh),
      "sidebar-primary": brand.primary,
      "sidebar-primary-foreground": brand["primary-foreground"],
      "sidebar-accent": ok(0.95, nc, nh),
      "sidebar-accent-foreground": ok(0.24, nc, nh),
      "sidebar-border": ok(0.9, nc, nh),
      "sidebar-ring": brand.ring
    };
  }
  return {
    "sidebar-background": ok(0.11, nc, nh),
    "sidebar-foreground": ok(0.9, nc, nh),
    "sidebar-primary": brand.primary,
    "sidebar-primary-foreground": brand["primary-foreground"],
    "sidebar-accent": ok(0.18, nc, nh),
    "sidebar-accent-foreground": ok(0.92, nc, nh),
    "sidebar-border": ok(0.25, nc, nh),
    "sidebar-ring": brand.ring
  };
}

function buildMode(spec: ThemeSpec, mode: Mode): CssVars {
  const brand = brandTokens(spec, mode);
  return {
    ...neutralTokens(spec, mode),
    ...brand,
    ...statusTokens(mode),
    ...chartTokens(mode),
    ...sidebarTokens(spec, mode, brand)
  };
}

function buildTheme(spec: ThemeSpec) {
  const light = buildMode(spec, "light");
  const dark_ = buildMode(spec, "dark");
  return {
    name: spec.name,
    label: spec.label,
    activeColor: {
      light: brandTokens(spec, "light").primary,
      dark: brandTokens(spec, "dark").primary
    },
    cssVars: { light, dark: dark_ }
  };
}

/**
 * Theme specs. Legacy names (zinc, neutral, red…) are preserved for backward
 * compatibility with stored theme cookies/settings; `zinc` remains the default
 * "Modern" graphite. New modern themes are appended.
 */
const THEME_SPECS: ThemeSpec[] = [
  { name: "zinc", label: "Modern", hue: 260, chroma: 0, kind: "neutral" },
  {
    name: "indigo",
    label: "Electric Indigo",
    hue: 275,
    chroma: 0.16,
    kind: "accent"
  },
  { name: "cobalt", label: "Cobalt", hue: 255, chroma: 0.15, kind: "accent" },
  {
    name: "emerald",
    label: "Emerald Tech",
    hue: 155,
    chroma: 0.15,
    kind: "accent"
  },
  { name: "acid", label: "Signal Acid", hue: 128, chroma: 0.19, kind: "acid" },
  {
    name: "coral",
    label: "Sunset Coral",
    hue: 40,
    chroma: 0.15,
    kind: "accent"
  },
  { name: "dusk", label: "Violet Dusk", hue: 310, chroma: 0.15, kind: "accent" }
];

export const themes = THEME_SPECS.map(buildTheme);

export type Theme = (typeof themes)[number];

/**
 * Retired theme names → nearest current theme. Keeps companies that stored a
 * legacy selection (Cherry, Blueberry, …) rendering correctly after pruning.
 */
export const THEME_ALIASES: Record<string, string> = {
  neutral: "zinc", // Brutal → Modern (visually near-identical)
  red: "coral", // Cherry → Sunset Coral
  orange: "coral", // Apricot → Sunset Coral
  yellow: "acid", // Lemon → Signal Acid
  green: "emerald", // Mint → Emerald Tech
  blue: "cobalt", // Blueberry → Cobalt
  violet: "dusk" // Lavender → Violet Dusk
};

/** Resolve a stored/selected theme name (applying aliases) to a Theme. */
export function resolveTheme(
  name: string | undefined | null
): Theme | undefined {
  if (!name) return undefined;
  const resolved = THEME_ALIASES[name] ?? name;
  return themes.find((t) => t.name === resolved);
}

/**
 * Serialize a theme to a `:root { … } .dark { … }` stylesheet. Retained for
 * callers that want to inject a full theme block; the apps instead read
 * `theme.cssVars` directly and inline the active mode.
 */
export function getThemeCode(theme: Theme) {
  if (!theme) return "";
  const toBlock = (vars: CssVars) =>
    Object.entries(vars)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join("\n");
  return `:root {\n${toBlock(theme.cssVars.light)}\n  --radius: 0.675rem;\n}\n\n.dark {\n${toBlock(theme.cssVars.dark)}\n}`;
}
