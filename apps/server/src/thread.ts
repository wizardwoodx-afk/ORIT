/**
 * SelfImpulse — thread.
 *
 * An append-only event log per Space. The UI does not hold state: it replays this log and the
 * server is the only writer. Every row the Thread shows is one of these events, which is why a
 * spinner can never appear without a backing fact.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StateId } from '@si/states';

export type PlanStep = {
  readonly id: string;
  readonly title: string;
  readonly tool: string;
  readonly effectClass: string;
  readonly recoveryClass: string;
  readonly resource: string;
};

export type ReceiptView = {
  readonly seq: number;
  readonly effect: string;
  readonly target: string;
  readonly recoveryClass: string;
  readonly grantId: string;
  readonly afterHash: string | null;
  readonly hash: string;
  readonly ledgerSeq: number;
};

export type ApprovalView = {
  readonly id: string;
  readonly turnId: string;
  readonly effect: string;
  readonly target: string;
  readonly paths: readonly string[];
  readonly changeSetHash: string;
  readonly recoveryClass: string;
  readonly risk: string;
  readonly dataClass: string;
  readonly expiresAt: number;
  readonly state: 'pending' | 'approved' | 'denied' | 'expired';
};

type Base = { readonly seq: number; readonly ts: number; readonly turnId: string | null };

export type ThreadEvent = Base &
  (
    | { readonly type: 'message'; readonly actor: 'user' | 'assistant'; readonly text: string; readonly conf: string; readonly integrity: string }
    | { readonly type: 'state'; readonly nodeId: string; readonly state: StateId; readonly reason: string }
    | { readonly type: 'plan'; readonly steps: readonly PlanStep[]; readonly changeSetHash: string | null }
    | { readonly type: 'approval'; readonly approval: ApprovalView }
    | { readonly type: 'receipt'; readonly receipt: ReceiptView }
    | { readonly type: 'check'; readonly id: string; readonly pass: boolean; readonly detail: string }
    | { readonly type: 'notice'; readonly text: string; readonly tone: 'info' | 'attn' | 'danger' }
  );

/** Omit has to distribute over the union, or every event type collapses into none of them. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<ThreadEvent, 'seq' | 'ts'>;

export type ThreadListener = (event: ThreadEvent) => void;

export class Thread {
  private readonly events: ThreadEvent[] = [];
  private readonly listeners = new Set<ThreadListener>();
  private seq = 0;

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ThreadEvent;
        this.events.push(parsed);
        this.seq = Math.max(this.seq, parsed.seq);
      } catch {
        // A torn final line from a crash is dropped; the ledger, not this log, is the authority.
      }
    }
  }

  append(event: NewEvent): ThreadEvent {
    this.seq += 1;
    const full = { ...event, seq: this.seq, ts: this.now() } as ThreadEvent;
    this.events.push(full);
    appendFileSync(this.path, `${JSON.stringify(full)}\n`);
    for (const listener of this.listeners) listener(full);
    return full;
  }

  /** Replay from a cursor. The client sends the last seq it holds. */
  list(since = 0): ThreadEvent[] {
    return this.events.filter((e) => e.seq > since);
  }

  get head(): number {
    return this.seq;
  }

  subscribe(listener: ThreadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
