import type { ActionClass, EffectClass, RecoveryClass } from '@si/core';

export type Detent = 1 | 2 | 3 | 4 | 5;
export type Verdict = 'allow' | 'ask' | 'deny' | 'guardian';

/** 1 Observe, 2 Ask, 3 Flow, 4 Run-scoped, 5 Standing. R3 is never automatic at any detent. */
export function dialMatrix(d: Detent, effect: EffectClass, action: ActionClass, recovery: RecoveryClass): Verdict {
  if (effect === 'none') return 'allow';
  if (recovery === 'R3') return d === 1 ? 'deny' : d === 5 ? 'deny' : 'ask'; // detent 5 queues for a human
  if (effect === 'sandbox') return d === 1 ? 'deny' : 'allow';
  if (action === 'edit') return d === 1 ? 'deny' : d === 2 ? 'ask' : 'allow';
  if (action === 'exec') return d === 1 ? 'deny' : d <= 3 ? 'ask' : 'allow';
  // net / external, recoverable by compensation (R2)
  return d === 1 ? 'deny' : d <= 3 ? 'ask' : 'guardian';
}
