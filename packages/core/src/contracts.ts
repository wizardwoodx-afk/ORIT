import { z } from 'zod';

export const ActionClass = z.enum(['read', 'edit', 'exec', 'net', 'external']);
export type ActionClass = z.infer<typeof ActionClass>;

/** R1 exact rollback, R2 compensation, R3 remediation only. */
export const RecoveryClass = z.enum(['R1', 'R2', 'R3']);
export type RecoveryClass = z.infer<typeof RecoveryClass>;

/** Declared by the tool manifest, never supplied by the model. */
export const EffectClass = z.enum(['none', 'sandbox', 'live', 'external']);
export type EffectClass = z.infer<typeof EffectClass>;

export const Phase = z.enum(['FRAME', 'PROBE', 'REHEARSE', 'COMMIT', 'PROVE', 'RETAIN']);
export type Phase = z.infer<typeof Phase>;

export const Op = z.enum(['read', 'write', 'delete', 'exec', 'send', 'net']);
export type Op = z.infer<typeof Op>;

/** What the (untrusted) brain may submit. Everything security-relevant is derived by the gateway. */
export const ToolCallSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  nodeId: z.string().min(1),
  step: z.number().int().nonnegative(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
