import { getBucket } from "./hash";

const cache: Record<string, number> = {};

const colorIndex = {
  gray: 0,
  lightGray: 1,
  brown: 2,
  orange: 3,
  yellow: 4,
  green: 5,
  blue: 6,
  purple: 7,
  pink: 8,
  red: 9
};

export type Color = keyof typeof colorIndex;

/* Notion-style label palette, derived from OKLCH (bg L=0.93 tint / text L=0.30
 * in light; bg L=0.24 / text L=0.90 in dark). Order matches `colorIndex`. */
const colors = [
  { background: "#e6e8eb", color: "#2b2e32" }, // gray
  { background: "#edeef1", color: "#2c2e31" }, // lightGray
  { background: "#f8e4d4", color: "#41270f" }, // brown
  { background: "#ffe1d1", color: "#492106" }, // orange
  { background: "#f2e8c3", color: "#3c2c00" }, // yellow
  { background: "#d5f0e0", color: "#063723" }, // green
  { background: "#d7ebfa", color: "#103146" }, // blue
  { background: "#ebe3fc", color: "#332649" }, // purple
  { background: "#fbdfeb", color: "#451f32" }, // pink
  { background: "#ffdfdc", color: "#49201d" } // red
];

const darkColors = [
  { background: "#1d1f22", color: "#dedede" }, // gray
  { background: "#1e1f22", color: "#dedede" }, // lightGray
  { background: "#2d1b0b", color: "#dedede" }, // brown
  { background: "#321706", color: "#dedede" }, // orange
  { background: "#291e00", color: "#dedede" }, // yellow
  { background: "#072618", color: "#dedede" }, // green
  { background: "#0c2230", color: "#dedede" }, // blue
  { background: "#231a32", color: "#dedede" }, // purple
  { background: "#2f1622", color: "#dedede" }, // pink
  { background: "#321614", color: "#dedede" } // red
];

export function getColor(color: Color, mode = "light") {
  return mode === "dark"
    ? darkColors[colorIndex[color]]
    : colors[colorIndex[color]];
}

export function getColorByValue(name: string, mode = "light") {
  if (cache[name])
    return mode === "dark" ? darkColors[cache[name]!] : colors[cache[name]!];
  const hash = getBucket(name, colors.length);
  cache[name] = hash;
  return mode === "dark" ? darkColors[hash] : colors[hash];
}
