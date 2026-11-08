/* Motion rules made executable.
 *
 * DESIGN 6 allows only transform and opacity, micro 120ms, panels 200ms, nothing over 300ms,
 * one easing curve, no overshoot, pause when the window is hidden, and honour reduced motion.
 * `TRANSITIONS` is the written table; a test holds it to those limits and the CSS only uses these
 * names, so a component cannot quietly invent a 500ms fade.
 */

export const EASING = 'cubic-bezier(0.2, 0, 0, 1)' as const;
export const MAX_DURATION_MS = 300;

export type Moment =
  | 'hover'
  | 'press'
  | 'panel-open'
  | 'panel-close'
  | 'tab-switch'
  | 'row-enter'
  | 'approval-rise'
  | 'receipt-reveal'
  | 'commit-wipe'
  | 'thinking-shimmer'
  | 'search-bar'
  | 'reading-dash'
  | 'glyph-arc';

export type TransitionSpec = {
  readonly moment: Moment;
  /** Only these two properties are allowed. */
  readonly property: 'opacity' | 'transform';
  /** CSS token that supplies the duration. */
  readonly duration: 'var(--t-micro)' | 'var(--t-panel)' | 'var(--t-wipe)' | 'var(--t-shimmer)' | 'var(--t-cursor)';
  readonly ms: number;
  readonly easing: typeof EASING;
  readonly reducedMotion: string;
};

const t = (moment: Moment, property: TransitionSpec['property'], duration: TransitionSpec['duration'], ms: number, reducedMotion: string): TransitionSpec => ({
  moment,
  property,
  duration,
  ms,
  easing: EASING,
  reducedMotion,
});

export const TRANSITIONS: readonly TransitionSpec[] = [
  t('hover', 'opacity', 'var(--t-micro)', 120, 'instant'),
  t('press', 'transform', 'var(--t-micro)', 120, 'instant'),
  t('panel-open', 'transform', 'var(--t-panel)', 200, 'fade 1ms'),
  t('panel-close', 'opacity', 'var(--t-panel)', 200, 'fade 1ms'),
  t('tab-switch', 'opacity', 'var(--t-micro)', 120, 'instant'),
  t('row-enter', 'transform', 'var(--t-panel)', 200, 'instant, row appears'),
  t('approval-rise', 'transform', 'var(--t-panel)', 200, 'instant, docked bar in place'),
  t('receipt-reveal', 'transform', 'var(--t-panel)', 200, 'instant'),
  t('commit-wipe', 'transform', 'var(--t-wipe)', 200, 'solid, no wipe'),
  t('thinking-shimmer', 'opacity', 'var(--t-shimmer)', 1600, 'static label'),
  t('search-bar', 'transform', 'var(--t-shimmer)', 1600, 'static hairline'),
  t('reading-dash', 'transform', 'var(--t-cursor)', 1000, 'static dash'),
  t('glyph-arc', 'transform', 'var(--t-cursor)', 1000, 'static arc'),
];

export type Matcher = { matches: boolean };

/** Reads the media query defensively: a test double or a missing matchMedia must not throw. */
export function prefersReducedMotion(matcher?: Matcher | null): boolean {
  return matcher?.matches === true;
}

/** Indices 0, 1, 2 -> 0ms, 40ms, 80ms. Capped so a long source list cannot crawl. */
export function staggerDelay(index: number, stepMs = 40, capMs = 400): string {
  const clamped = Math.max(0, Math.min(index, Math.floor(capMs / stepMs)));
  return `${clamped * stepMs}ms`;
}

export type VisibilityTarget = {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
  readonly hidden: boolean;
};

export type ClassSink = { classList: { toggle(name: string, force?: boolean): unknown } };

export const HIDDEN_CLASS = 'is-window-hidden';

/** Design 6: animations pause when the window is hidden. Returns a dispose function. */
export function pauseWhenHidden(target: VisibilityTarget, root: ClassSink): () => void {
  const sync = (): void => {
    root.classList.toggle(HIDDEN_CLASS, target.hidden);
  };
  target.addEventListener('visibilitychange', sync);
  sync();
  return () => target.removeEventListener('visibilitychange', sync);
}

export function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => run());
  else setTimeout(run, 0);
}
