/**
 * SelfImpulse — voice.
 *
 * Copy is code. The product speaks in one register everywhere it speaks: plain, steady,
 * specific, a little dry. Past tense for what happened, future for what is about to.
 * This module is the single source of that register, so it can be tested instead of
 * remembered. Consumed by the app server and the renderer.
 */

/** The signature. Wherever SelfImpulse signs its own work, it uses these exact strings. */
export const SIGNATURE = {
  product: 'SelfImpulse',
  /** The mark in a header or a footer. One token, always lowercase, always after a slash. */
  mark: '//impulse',
  /** One line, no adjectives that cannot be checked. */
  tagline: 'Governed agency. Every effect has a receipt.',
  /** The line every module header carries. */
  banner: 'SelfImpulse — plain, steady, specific.',
  /** Stamped on a receipt that proved itself. */
  seal: 'sealed',
} as const;

/** Words this product does not use. Tests fail if one reaches a user-facing string. */
export const HYPE = [
  'successfully',
  'oops',
  'oops!',
  'amazing',
  'awesome',
  'magic',
  'magical',
  'seamless',
  'effortlessly',
  'effortless',
  'revolutionary',
  'supercharge',
  'unleash',
  'cutting-edge',
  'game-changing',
  'sorry',
  'unfortunately',
  'whoops',
  'congratulations',
  'exciting',
] as const;

/** Exclamation marks are also a tell. A status line is not a greeting. */
export const auditVoice = (text: string): string[] => {
  const lower = text.toLowerCase();
  const found: string[] = HYPE.filter((word) => lower.includes(word));
  if (text.includes('!')) found.push('exclamation mark');
  return found;
};

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

const list = (items: readonly string[], max = 3): string =>
  items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;

/** What a finished turn says. Numbers first, because numbers are checkable. */
export const say = {
  done: (files: readonly string[], checksPassed: number, checksTotal: number): string =>
    `Done. Changed ${files.length} ${plural(files.length, 'file')} (${list(files)}). ` +
    `${checksPassed} of ${checksTotal} ${plural(checksTotal, 'check')} pass. Receipts below.`,

  doneWithDrift: (paths: readonly string[]): string =>
    `Stopped before writing. The live files moved since rehearsal: ${list(paths)}. Nothing changed.`,

  blocked: (rule: string): string => `Blocked: policy forbids this (rule ${rule}).`,

  denied: (layer: string, reason: string): string => `Denied at ${layer}: ${reason}.`,

  needsApproval: (effect: string, target: string, recovery: string): string =>
    `Waiting for your signature: ${effect} on ${target}. Recovery class ${recovery}.`,

  failed: (name: string, message: string): string => `Failed: ${name}. ${message}.`,

  cancelled: (): string => 'Cancelled before anything was written.',

  expired: (): string => 'The approval window closed. Nothing was written.',

  rolledBack: (paths: readonly string[]): string =>
    `Rolled back ${paths.length} ${plural(paths.length, 'file')}, verified by hash.`,

  receipt: (seq: number, hash: string): string => `Receipt ${seq}, ledger head ${hash.slice(0, 12)}.`,
} as const;
