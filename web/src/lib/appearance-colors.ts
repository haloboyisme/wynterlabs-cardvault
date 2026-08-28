export const ACCENT_BASE = {
  frost: "#5BE7E7", arctic: "#9DEBFF", sky: "#65C7FF", azure: "#3FA7FF",
  cobalt: "#3977FF", navy: "#5C7CFA", indigo: "#6C63FF", iris: "#7E6BFF",
  violet: "#9A6BFF", plum: "#B06BD3", orchid: "#D36BDE", magenta: "#EB4FC7",
  rose: "#F767A1", ruby: "#E94B72", crimson: "#E5484D", coral: "#FF7B72",
  ember: "#FF6B4A", orange: "#FF922B", amber: "#F6B73C", gold: "#D9B44A",
  lemon: "#D7D948", lime: "#9ACD32", leaf: "#6CBF4A", emerald: "#35B779",
  mint: "#4FD1A5", teal: "#2FB5AA", aqua: "#3CCFD5", cyan: "#22D3EE",
  steel: "#7FA4C9", slate: "#8796A5", graphite: "#8B8F97", mono: "#C8CDD4",
  glacier: "#B8F4FF", ocean: "#147DF5", ultramarine: "#304FFE", lavender: "#C4A7FF",
  wisteria: "#A98BEF", bubblegum: "#FF8DC7", cherry: "#D7264E", scarlet: "#FF3B30",
  peach: "#FFB38A", tangerine: "#FF7A00", honey: "#E6A700", moss: "#769642",
  pine: "#23865A", seafoam: "#6EE7C4", turquoise: "#14B8A6", silver: "#B8C2CC",
} as const;

export type AppearanceAccent = keyof typeof ACCENT_BASE;

export const APPEARANCE_ACCENTS = Object.freeze(Object.keys(ACCENT_BASE)) as readonly AppearanceAccent[];

export interface AccentTokens {
  accent: string;
  link: string;
  soft: string;
  softInk: string;
  ink: string;
}

const DARK_SURFACE = "#08111D";
const FROST_SURFACE = "#0C1520";
const LIGHT_SURFACE = "#F6F8FB";
const THEME_SURFACES = {
  midnight: DARK_SURFACE,
  frost: FROST_SURFACE,
  light: LIGHT_SURFACE,
  aurora: "#071713",
  amethyst: "#160D20",
  ember: "#1B0E0B",
  forest: "#0B1710",
  sandstone: "#F7F0E4",
  slate: "#101721",
} as const;
export type ResolvedAppearanceTheme = keyof typeof THEME_SURFACES;
const DARK_INK = "#000000";
const LIGHT_INK = "#FFFFFF";

export function parseCustomAccent(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toUpperCase()
    : null;
}

function rgb(hex: string): [number, number, number] {
  const parsed = parseCustomAccent(hex);
  if (!parsed) throw new TypeError("Expected a six-digit hexadecimal color.");
  return [
    Number.parseInt(parsed.slice(1, 3), 16),
    Number.parseInt(parsed.slice(3, 5), 16),
    Number.parseInt(parsed.slice(5, 7), 16),
  ];
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map(channelLuminance);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(hex: string): [number, number, number] {
  const [red, green, blue] = rgb(hex).map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  if (delta === 0) return [0, 0, lightness];

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (maximum === red) hue = ((green - blue) / delta) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [((hue * 60) + 360) % 360, saturation, lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const shifted = hue / 60;
  const secondary = chroma * (1 - Math.abs((shifted % 2) - 1));
  const [red, green, blue] = shifted < 1 ? [chroma, secondary, 0]
    : shifted < 2 ? [secondary, chroma, 0]
      : shifted < 3 ? [0, chroma, secondary]
        : shifted < 4 ? [0, secondary, chroma]
          : shifted < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  const toHex = (channel: number) => Math.round((channel + match) * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`.toUpperCase();
}

function accessibleLink(base: string, surface: string): string {
  const [hue, saturation, initialLightness] = rgbToHsl(base);
  const direction = relativeLuminance(surface) > 0.5 ? -1 : 1;
  for (let step = 0; step <= 20; step += 1) {
    const lightness = Math.min(1, Math.max(0, initialLightness + direction * step * 0.05));
    const candidate = hslToHex(hue, saturation, lightness);
    if (contrastRatio(candidate, surface) >= 4.5) return candidate;
  }
  return direction < 0 ? "#000000" : LIGHT_INK;
}

function rgba(hex: string, alpha: number): string {
  const [red, green, blue] = rgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function composite(foreground: string, background: string, alpha: number): string {
  const foregroundChannels = rgb(foreground);
  const backgroundChannels = rgb(background);
  const channels = foregroundChannels.map((channel, index) =>
    Math.round(channel * alpha + backgroundChannels[index] * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function buttonInk(base: string): string {
  return contrastRatio(DARK_INK, base) >= contrastRatio(LIGHT_INK, base) ? DARK_INK : LIGHT_INK;
}

export function accentTokens(
  accent: AppearanceAccent | "custom",
  customAccent: string | null,
  theme: ResolvedAppearanceTheme,
): AccentTokens {
  const base = accent === "custom" ? parseCustomAccent(customAccent) ?? ACCENT_BASE.frost : ACCENT_BASE[accent];
  const surface = THEME_SURFACES[theme];
  const softSurface = composite(base, surface, 0.16);
  return {
    accent: base,
    link: accessibleLink(base, surface),
    soft: rgba(base, 0.16),
    softInk: buttonInk(softSurface),
    ink: buttonInk(base),
  };
}
