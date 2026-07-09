/**
 * OKLCH color system + theme engine.
 *
 * Every theme is generated from a compact spec (a brand hue plus its primary
 * lightness/chroma in each mode) by `buildTheme`, which emits full `oklch(...)`
 * strings for all semantic tokens in both light and dark modes.
 *
 * Surfaces are intentionally achromatic (Vercel/Geist-style crisp grays, pure
 * white / pure black extremes); only the brand tokens (primary, active, ring,
 * sidebar-primary) carry the theme hue. The eight themes are Carbon's existing
 * palette — the same identities, expressed in OKLCH and enriched, not a new set.
 *
 * Token values are complete color strings (not bare HSL triplets), so every
 * consumer references them directly as `var(--token)` — never `hsl(var(--token))`.
 */

type Mode = "light" | "dark";

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

/** Brand primary in one mode. */
type Brand = { l: number; c: number };

export type ThemeSpec = {
  name: string;
  label: string;
  /** Brand hue in OKLCH degrees. */
  hue: number;
  /** Brand primary lightness/chroma in light mode (chroma 0 = achromatic graphite). */
  light: Brand;
  /** Brand primary lightness/chroma in dark mode. */
  dark: Brand;
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

/**
 * Brand-derived tokens: primary, active, ring. Neutral themes (light chroma 0)
 * render a crisp graphite ramp — near-black primary in light, pure white in dark
 * — like the original Modern/Brutal themes. Colored themes tint primary/active/
 * ring with the brand hue while surfaces stay achromatic.
 */
function brandTokens(spec: ThemeSpec, mode: Mode): BrandVars {
  const h = spec.hue;
  const { l, c } = spec[mode];
  const isNeutral = spec.light.c === 0;

  if (isNeutral) {
    if (mode === "light") {
      return {
        primary: ok(l, 0, 0),
        "primary-foreground": ok(0.985, 0, 0),
        active: ok(0.904, 0, 0),
        "active-foreground": ok(0.213, 0, 0),
        ring: ok(l, 0, 0)
      };
    }
    return {
      primary: ok(l, 0, 0),
      "primary-foreground": ok(0, 0, 0),
      active: ok(0.216, 0, 0),
      "active-foreground": ok(0.985, 0, 0),
      ring: ok(0.465, 0, 0)
    };
  }

  // Dark ink on light/bright primaries (yellow, orange); near-white otherwise.
  const primaryFg = l > 0.68 ? ok(0.2, c * 0.35, h) : ok(0.985, c * 0.02, h);

  if (mode === "light") {
    return {
      primary: ok(l, c, h),
      "primary-foreground": primaryFg,
      active: ok(0.95, c * 0.16, h),
      "active-foreground": ok(0.42, c * 0.7, h),
      ring: ok(l, c, h)
    };
  }
  return {
    primary: ok(l, c, h),
    "primary-foreground": primaryFg,
    active: ok(0.26, c * 0.4, h),
    "active-foreground": ok(0.82, c * 0.7, h),
    ring: ok(l, c, h)
  };
}

/**
 * Neutral surfaces, text, borders — achromatic (Vercel/Geist grays). Identical
 * across every theme; pure white background in light, pure black in dark.
 */
function neutralTokens(mode: Mode): CssVars {
  if (mode === "light") {
    return {
      background: ok(1, 0, 0),
      foreground: ok(0.145, 0, 0),
      card: ok(1, 0, 0),
      "card-foreground": ok(0.145, 0, 0),
      popover: ok(1, 0, 0),
      "popover-foreground": ok(0.145, 0, 0),
      secondary: ok(0.968, 0, 0),
      "secondary-foreground": ok(0.213, 0, 0),
      muted: ok(0.968, 0, 0),
      "muted-foreground": ok(0.556, 0, 0),
      accent: ok(0.968, 0, 0),
      "accent-foreground": ok(0.213, 0, 0),
      border: ok(0.922, 0, 0),
      input: ok(0.922, 0, 0)
    };
  }
  return {
    background: ok(0, 0, 0),
    foreground: ok(0.947, 0, 0),
    card: ok(0.146, 0, 0),
    "card-foreground": ok(0.947, 0, 0),
    popover: ok(0.182, 0, 0),
    "popover-foreground": ok(0.947, 0, 0),
    secondary: ok(0.182, 0, 0),
    "secondary-foreground": ok(0.947, 0, 0),
    muted: ok(0.27, 0, 0),
    "muted-foreground": ok(0.708, 0, 0),
    accent: ok(0.216, 0, 0),
    "accent-foreground": ok(0.947, 0, 0),
    border: ok(0.27, 0, 0),
    input: ok(0.27, 0, 0)
  };
}

/** Sidebar surfaces (achromatic) with the brand primary/ring threaded through. */
function sidebarTokens(mode: Mode, brand: BrandVars): CssVars {
  if (mode === "light") {
    return {
      "sidebar-background": ok(0.985, 0, 0),
      "sidebar-foreground": ok(0.35, 0, 0),
      "sidebar-primary": brand.primary,
      "sidebar-primary-foreground": brand["primary-foreground"],
      "sidebar-accent": ok(0.955, 0, 0),
      "sidebar-accent-foreground": ok(0.213, 0, 0),
      "sidebar-border": ok(0.922, 0, 0),
      "sidebar-ring": brand.ring
    };
  }
  return {
    "sidebar-background": ok(0.11, 0, 0),
    "sidebar-foreground": ok(0.9, 0, 0),
    "sidebar-primary": brand.primary,
    "sidebar-primary-foreground": brand["primary-foreground"],
    "sidebar-accent": ok(0.2, 0, 0),
    "sidebar-accent-foreground": ok(0.947, 0, 0),
    "sidebar-border": ok(0.27, 0, 0),
    "sidebar-ring": brand.ring
  };
}

function buildMode(spec: ThemeSpec, mode: Mode): CssVars {
  const brand = brandTokens(spec, mode);
  return {
    ...neutralTokens(mode),
    ...brand,
    ...statusTokens(mode),
    ...chartTokens(mode),
    ...sidebarTokens(mode, brand)
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
 * Carbon's eight themes, in OKLCH. Each brand primary is anchored on that theme's
 * original identity, enriched (higher chroma) and brought into the crisp
 * Vercel-neutral chassis. Blue is de-purpled (its old hue sat at ~273); violet
 * holds the purple end so the two stay distinct. `zinc` (Modern) is the default.
 */
const THEME_SPECS: ThemeSpec[] = [
  {
    name: "zinc",
    label: "Modern",
    hue: 0,
    light: { l: 0.213, c: 0 },
    dark: { l: 1, c: 0 }
  },
  {
    name: "neutral",
    label: "Brutal",
    hue: 0,
    light: { l: 0.213, c: 0 },
    dark: { l: 1, c: 0 }
  },
  {
    name: "red",
    label: "Cherry",
    hue: 27,
    light: { l: 0.6, c: 0.215 },
    dark: { l: 0.64, c: 0.2 }
  },
  {
    name: "orange",
    label: "Apricot",
    hue: 47,
    light: { l: 0.705, c: 0.185 },
    dark: { l: 0.75, c: 0.15 }
  },
  {
    name: "yellow",
    label: "Lemon",
    hue: 92,
    light: { l: 0.85, c: 0.17 },
    dark: { l: 0.87, c: 0.17 }
  },
  {
    name: "green",
    label: "Mint",
    hue: 165,
    light: { l: 0.66, c: 0.13 },
    dark: { l: 0.74, c: 0.14 }
  },
  {
    name: "blue",
    label: "Blueberry",
    hue: 250,
    light: { l: 0.58, c: 0.16 },
    dark: { l: 0.68, c: 0.17 }
  },
  {
    name: "violet",
    label: "Lavender",
    hue: 300,
    light: { l: 0.53, c: 0.235 },
    dark: { l: 0.67, c: 0.19 }
  }
];

export const themes = THEME_SPECS.map(buildTheme);

export type Theme = (typeof themes)[number];

/**
 * Retired theme names → nearest current theme. Empty for now: every current name
 * is a real theme, so stored cookies/settings resolve directly. Add an entry
 * here if a theme name is ever renamed or removed.
 */
export const THEME_ALIASES: Record<string, string> = {};

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
