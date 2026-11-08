/* The state vocabulary from DESIGN 5. Fifteen states, never collapsed into one spinner.
 * Each state carries a glyph drawn on the 16px grid, a label, a reason line, and the live-region
 * politeness for screen readers. The glyphs are inline SVG strings so they inherit `currentColor`
 * and need no icon font, no sprite, and no network request.
 */

export const STATE_IDS = [
  'draft',
  'framed',
  'needs-approval',
  'rehearsing',
  'ready-to-commit',
  'running',
  'verifying',
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
  'rolled-back',
  'partially-completed',
  'drifted',
] as const;

export type StateId = (typeof STATE_IDS)[number];

export type Tone = 'idle' | 'framed' | 'run' | 'wait' | 'done' | 'fail' | 'recovered';

export type StateMeta = {
  readonly id: StateId;
  /** Row label. Lowercase; the UI sentence-cases it where it starts a line. */
  readonly label: string;
  /** One line of why, shown under the label. Never a mood, always a fact. */
  readonly reason: string;
  readonly tone: Tone;
  /** True once the state cannot change on its own; loaders stop here. */
  readonly terminal: boolean;
  /** Which motion the row is entitled to. `none` means static. */
  readonly motion: 'none' | 'shimmer' | 'arc' | 'ring' | 'dash' | 'bar' | 'wipe';
  /** Screen-reader announcement politeness. Routine progress is `off` to avoid a chatty loop. */
  readonly live: 'off' | 'polite' | 'assertive';
  /** CSS class the row gets, e.g. `state-needs-approval`. */
  readonly className: string;
};

const meta = (
  id: StateId,
  label: string,
  reason: string,
  tone: Tone,
  motion: StateMeta['motion'],
  live: StateMeta['live'],
  terminal: boolean,
): StateMeta => ({ id, label, reason, tone, motion, live, terminal, className: `state-${id}` });

export const STATES: Readonly<Record<StateId, StateMeta>> = {
  draft: meta('draft', 'draft', 'Nothing has run yet.', 'idle', 'none', 'off', false),
  framed: meta('framed', 'framed', 'The plan is written; it is not approved.', 'framed', 'none', 'polite', false),
  'needs-approval': meta(
    'needs-approval',
    'needs approval',
    'Waiting for a human signature on the exact effect.',
    'wait',
    'ring',
    'assertive',
    false,
  ),
  rehearsing: meta(
    'rehearsing',
    'rehearsing',
    'Running against a shadow copy. Nothing here is real yet.',
    'framed',
    'dash',
    'polite',
    false,
  ),
  'ready-to-commit': meta(
    'ready-to-commit',
    'ready to commit',
    'The rehearsal matched; commit will replay it.',
    'done',
    'none',
    'polite',
    false,
  ),
  running: meta('running', 'running', 'Executing now.', 'run', 'arc', 'off', false),
  verifying: meta('verifying', 'verifying', 'Checking the result against the declared checks.', 'framed', 'bar', 'polite', false),
  completed: meta('completed', 'completed', 'Done, with a receipt.', 'done', 'none', 'polite', true),
  blocked: meta('blocked', 'blocked', 'Stopped by a rule or a missing prerequisite.', 'wait', 'none', 'assertive', true),
  failed: meta('failed', 'failed', 'It did not work. The reason is attached.', 'fail', 'none', 'assertive', true),
  cancelled: meta('cancelled', 'cancelled', 'You stopped it before it finished.', 'idle', 'none', 'polite', true),
  expired: meta('expired', 'expired', 'The approval window closed.', 'idle', 'none', 'polite', true),
  'rolled-back': meta('rolled-back', 'rolled back', 'The change was undone and verified by hash.', 'recovered', 'none', 'polite', true),
  'partially-completed': meta(
    'partially-completed',
    'partially completed',
    'Some effects landed. The rest did not.',
    'wait',
    'none',
    'assertive',
    true,
  ),
  drifted: meta(
    'drifted',
    'drifted',
    'The world changed between rehearsal and commit.',
    'wait',
    'none',
    'assertive',
    true,
  ),
};

const svg = (body: string, size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
  `stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${body}</svg>`;

/** Static glyph paths on the 16px grid. Motion is added by CSS on `.glyph-<state>`. */
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
