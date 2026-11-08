/**
 * SelfImpulse — state vocabulary.
 *
 * The fifteen states from DESIGN 5, as data: id, label, reason, tone, which motion it is entitled
 * to, and how it announces itself. Shared by the kernel host and the renderer so the two can never
 * disagree about what a state is called. Glyphs live in the renderer; a state is not a picture.
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
export type Motion = 'none' | 'shimmer' | 'arc' | 'ring' | 'dash' | 'bar' | 'wipe';
export type Politeness = 'off' | 'polite' | 'assertive';

export type StateMeta = {
  readonly id: StateId;
  readonly label: string;
  readonly reason: string;
  readonly tone: Tone;
  /** True once the state cannot change on its own; loaders stop here. */
  readonly terminal: boolean;
  readonly motion: Motion;
  readonly live: Politeness;
  readonly className: string;
};

const meta = (
  id: StateId,
  label: string,
  reason: string,
  tone: Tone,
  motion: Motion,
  live: Politeness,
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
  drifted: meta('drifted', 'drifted', 'The world changed between rehearsal and commit.', 'wait', 'none', 'assertive', true),
};

export const isStateId = (value: unknown): value is StateId =>
  typeof value === 'string' && (STATE_IDS as readonly string[]).includes(value);
