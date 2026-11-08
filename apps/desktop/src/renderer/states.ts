/**
 * SelfImpulse — state glyphs.
 *
 * The vocabulary lives in `@si/states` so the kernel host and this renderer cannot disagree about
 * what a state is called. This file adds the drawing: inline SVG on the 16px grid, inheriting
 * `currentColor`, so a state needs no icon font, no sprite and no network.
 */
import { STATES, STATE_IDS, type StateId, type StateMeta } from '@si/states';

export { STATES, STATE_IDS };
export type { StateId, StateMeta };

const svg = (body: string, size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
  `stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${body}</svg>`;

const PATHS: Readonly<Record<StateId, string>> = {
  draft: '<circle cx="8" cy="8" r="5.25" stroke-dasharray="1.5 2.5"/>',
  framed: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
  'needs-approval': '<circle cx="8" cy="8" r="5.5" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5"/>',
  rehearsing: '<path d="M3 5.5h10" stroke-dasharray="2 2"/><path d="M3 10.5h10" stroke-dasharray="2 2"/>',
  'ready-to-commit': '<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l2 2 3.5-4"/>',
  running: '<path d="M8 2.75a5.25 5.25 0 1 1-5.25 5.25"/>',
  verifying: '<circle cx="8" cy="8" r="5.25"/><path d="M4 8h8" stroke-dasharray="2 2"/>',
  completed: '<path d="M3 8.5l3 3 7-7"/>',
  blocked: '<circle cx="8" cy="8" r="5.5"/><path d="M5 8h6"/>',
  failed: '<path d="M4 4l8 8M12 4l-8 8"/>',
  cancelled: '<circle cx="8" cy="8" r="5.5"/><path d="M4.5 11.5l7-7"/>',
  expired: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.75V8l2.5 1.5"/>',
  'rolled-back': '<path d="M4.5 7.5a3.5 3.5 0 1 1 1.5 3.9"/><path d="M4.5 4v3.5H8"/>',
  'partially-completed': '<path d="M2.5 8.5l3 3 3-3"/><path d="M10 11.5h3.5" stroke-dasharray="1.5 2"/>',
  drifted: '<path d="M3 12L8 7l5 5"/><path d="M5.5 4h5"/>',
};

export function glyph(state: StateId, size = 16): string {
  return svg(PATHS[state], size);
}

/** The tone token a state is allowed to use. Color means state. */
export const toneOf = (state: StateId): string => STATES[state].tone;

/** The row model a list renders: state, label, reason, tone, and the CSS hooks. */
export function stateRow(state: StateId): {
  readonly state: StateId;
  readonly label: string;
  readonly reason: string;
  readonly glyph: string;
  readonly className: string;
  readonly toneVar: string;
  readonly live: StateMeta['live'];
  readonly animating: boolean;
} {
  const entry = STATES[state];
  return {
    state,
    label: entry.label,
    reason: entry.reason,
    glyph: glyph(state),
    className: entry.className,
    toneVar: `var(--tone-${entry.tone})`,
    live: entry.live,
    animating: entry.motion !== 'none' && !entry.terminal,
  };
}
