/**
 * SelfImpulse — the wire.
 *
 * The renderer's only way to know anything. Every payload crosses this boundary through a schema
 * (RULES 19), so a shape change on the server is a visible failure here, not a blank panel.
 */
import { STATE_IDS } from '@si/states';
import { z } from 'zod';

export const StateIdSchema = z.enum(STATE_IDS);

const PlanStep = z.object({
  id: z.string(),
  title: z.string(),
  tool: z.string(),
  effectClass: z.string(),
  recoveryClass: z.string(),
  resource: z.string(),
});

const Receipt = z.object({
  seq: z.number(),
  effect: z.string(),
  target: z.string(),
  recoveryClass: z.string(),
  grantId: z.string(),
  afterHash: z.string().nullable(),
  hash: z.string(),
  ledgerSeq: z.number(),
});

export const ApprovalSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  effect: z.string(),
  target: z.string(),
  paths: z.array(z.string()),
  changeSetHash: z.string(),
  recoveryClass: z.string(),
  risk: z.string(),
  dataClass: z.string(),
  expiresAt: z.number(),
  state: z.enum(['pending', 'approved', 'denied', 'expired']),
});
export type Approval = z.infer<typeof ApprovalSchema>;

const base = { seq: z.number(), ts: z.number(), turnId: z.string().nullable() };

export const ThreadEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('message'), actor: z.enum(['user', 'assistant']), text: z.string(), conf: z.string(), integrity: z.string() }),
  z.object({ ...base, type: z.literal('state'), nodeId: z.string(), state: StateIdSchema, reason: z.string() }),
  z.object({ ...base, type: z.literal('plan'), steps: z.array(PlanStep), changeSetHash: z.string().nullable() }),
  z.object({ ...base, type: z.literal('approval'), approval: ApprovalSchema }),
  z.object({ ...base, type: z.literal('receipt'), receipt: Receipt }),
  z.object({ ...base, type: z.literal('check'), id: z.string(), pass: z.boolean(), detail: z.string() }),
  z.object({ ...base, type: z.literal('notice'), text: z.string(), tone: z.enum(['info', 'attn', 'danger']) }),
]);

export type ThreadEvent = z.infer<typeof ThreadEventSchema>;
export type PlanStepView = z.infer<typeof PlanStep>;
export type ReceiptView = z.infer<typeof Receipt>;

export const SnapshotSchema = z.object({
  space: z.string(),
  label: z.string(),
  note: z.string(),
  policyCeiling: z.string(),
  dial: z.number(),
  thread: z.array(ThreadEventSchema),
  head: z.number(),
  pending: z.array(ApprovalSchema),
  ledger: z.object({
    seq: z.number(),
    head: z.string().nullable(),
    chainOk: z.boolean(),
    heads: z.number(),
  }),
  workspace: z.object({ files: z.array(z.string()) }),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const jsonFetch = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
};

export const api = {
  async snapshot(space: string, since = 0): Promise<Snapshot> {
    return SnapshotSchema.parse(await jsonFetch(`/api/state?space=${encodeURIComponent(space)}&since=${since}`));
  },

  async message(space: string, text: string): Promise<{ turnId: string }> {
    const body = await jsonFetch('/api/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space, text }),
    });
    return z.object({ turnId: z.string() }).parse(body);
  },

  async decide(space: string, id: string, decision: 'approve' | 'deny'): Promise<void> {
    await jsonFetch('/api/approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space, id, decision }),
    });
  },

  /** Live events. Returns a dispose function; reconnects with the last seen cursor. */
  stream(space: string, cursor: number, onEvent: (event: ThreadEvent) => void, onGap: () => void): () => void {
    let seen = cursor;
    let closed = false;
    let source: EventSource | null = null;
    const open = (): void => {
      if (closed) return;
      source = new EventSource(`/api/stream?space=${encodeURIComponent(space)}&cursor=${seen}`);
      source.onmessage = (message) => {
        const parsed = ThreadEventSchema.safeParse(JSON.parse(message.data as string));
        if (!parsed.success) {
          onGap();
          return;
        }
        seen = Math.max(seen, parsed.data.seq);
        onEvent(parsed.data);
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      source?.close();
    };
  },
};
