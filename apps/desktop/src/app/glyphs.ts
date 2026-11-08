/**
 * SelfImpulse — glyph surface for the workbench.
 *
 * One import point, so the workbench never reaches into the design-system internals directly.
 */
export { glyph, toneOf } from '../renderer/states.ts';
export type { StateId } from '../renderer/states.ts';

/** Interface icons: 16px line glyphs, one stroke weight, no fills. Exported here so the workbench
 *  has a single drawing surface and never inlines an SVG of its own. */
const ICONS = {
  sidebar: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M6.5 3.5v9"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  panel: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M9.5 3.5v9"/>',
  send: '<path d="M3.5 8h8.5M9 4.8L12.2 8 9 11.2"/>',
  attach: '<path d="M10.2 4.8L6.1 8.9a2 2 0 102.8 2.8l4.1-4.1a3.1 3.1 0 00-4.4-4.4L4.2 7.6"/>',
  check: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  dial: '<circle cx="8" cy="8" r="5.2"/><path d="M8 8l3-1.8"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): string =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
