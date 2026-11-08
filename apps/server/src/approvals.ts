/**
 * SelfImpulse — approvals.
 *
 * A human signature is the only thing that turns a rehearsal into an order revision. This holds the
 * pending request, its argument binding (the ChangeSet hash), and its expiry. Nothing here can
 * approve itself, and silence expires rather than proceeds.
 */
import { randomId } from '@si/core';
import type { ApprovalView } from './thread.ts';

export type Decision = 'approved' | 'denied' | 'expired';

type Entry = {
  view: ApprovalView;
  settle: (decision: Decision) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class ApprovalDesk {
  private readonly entries = new Map<string, Entry>();

  request(view: Omit<ApprovalView, 'id' | 'state'>, now = Date.now()): { view: ApprovalView; decided: Promise<Decision> } {
    const id = randomId(6);
    const full: ApprovalView = { ...view, id, state: 'pending' };
    let settle: (decision: Decision) => void = () => undefined;
    const decided = new Promise<Decision>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => this.finish(id, 'expired'), Math.max(0, full.expiresAt - now));
    timer.unref?.();
    this.entries.set(id, { view: full, settle, timer });
    return { view: full, decided };
  }

  decide(id: string, choice: 'approve' | 'deny'): ApprovalView | null {
    const entry = this.entries.get(id);
    if (!entry || entry.view.state !== 'pending') return entry ? entry.view : null;
    this.finish(id, choice === 'approve' ? 'approved' : 'denied');
    return entry.view;
  }

  private finish(id: string, decision: Decision): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.view = { ...entry.view, state: decision };
    if (entry.timer) clearTimeout(entry.timer);
    entry.settle(decision);
    this.entries.delete(id);
  }

  pending(): ApprovalView[] {
    return [...this.entries.values()].map((e) => e.view);
  }

  list(): ApprovalView[] {
    return this.pending();
  }
}
