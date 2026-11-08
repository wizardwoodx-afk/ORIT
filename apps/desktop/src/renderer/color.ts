/* Color math used to keep every theme honest. Pure functions, no DOM, so tests and the
 * contrast report share one implementation (RULES 26: injected inputs, deterministic output). */

export type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseHex(input: string): Rgba | null {
  const value = input.trim();
  if (!HEX.test(value)) return null;
  const digits = value.slice(1);
  const expand = (hex: string): number[] =>
    hex.split('').map((c) => Number.parseInt(hex.length <= 4 ? c + c : c, 16));
  const [r, g, b, a] = digits.length <= 4 ? expand(digits) : [0, 2, 4, 6].map((i) => Number.parseInt(digits.slice(i, i + 2), 16));
  return {
    r: r ?? 0,
    g: g ?? 0,
    b: b ?? 0,
    a: digits.length === 4 || digits.length === 8 ? (a ?? 255) / 255 : 1,
  };
}

export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.2 contrast ratio between two colors, either of which may carry alpha. */
export function contrast(foreground: Rgba, background: Rgba): number {
  const back = background.a < 1 ? composite(background, { r: 255, g: 255, b: 255, a: 1 }) : background;
  const front = foreground.a < 1 ? composite(foreground, back) : foreground;
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

export function contrastOf(foreground: string, background: string): number | null {
  const f = parseHex(foreground);
  const b = parseHex(background);
  return f && b ? contrast(f, b) : null;
}

/** Pair floors. A theme that misses one of these fails `npm run verify`. */
export const CONTRAST_FLOORS = [
  { from: 'fg', on: ['bg', 's1', 's2'], min: 7, why: 'body text (DESIGN 11)' },
  { from: 'fg-dim', on: ['bg', 's1', 's2'], min: 4.5, why: 'secondary text' },
  { from: 'fg-faint', on: ['bg', 's1'], min: 3, why: 'tertiary marks' },
  { from: 'accent-ink', on: ['bg', 's1', 's2'], min: 3, why: 'state glyphs and accent text' },
  { from: 'co-think', on: ['bg', 's1', 's2'], min: 3, why: 'Space identity dot' },
  { from: 'co-work', on: ['bg', 's1', 's2'], min: 3, why: 'Space identity dot' },
  { from: 'attn', on: ['bg', 's1'], min: 3, why: 'needs-approval dot' },
  { from: 'danger', on: ['bg', 's1'], min: 3, why: 'failure glyph' },
  { from: 'line', on: ['bg'], min: 1.15, why: 'visible hairline' },
  { from: 'line-strong', on: ['bg'], min: 1.5, why: 'control border' },
  { from: 'btn-fg', on: ['btn'], min: 4.5, why: 'primary button label' },
  { from: 'fg', on: ['diff-add', 'diff-del'], min: 4.5, why: 'code on a diff fill' },
] as const;

export type FloorResult = {
  readonly token: string;
  readonly on: string;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
  readonly why: string;
};
