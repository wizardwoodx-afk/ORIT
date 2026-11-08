/**
 * SelfImpulse — the deterministic turn.
 *
 * Frame, Rehearse, Commit, Prove, Retain with no model in the loop. The plan is derived from the
 * request by a local template: it proves the governance path end to end, and it is the fallback the
 * harness uses when no provider is configured, so the product always has one honest way to work.
 */
import { randomId } from '@si/core';
import { Rehearsal, verifyChangeSetIntegrity } from '@si/changeset';
import type { OrderAuthority, OrderRevision, ScopeEntry } from '@si/gateway';
import { makeRevision } from '@si/gateway';
import { SIGNATURE, say } from '@si/voice';
import type { ApprovalDesk } from './approvals.ts';
import type { GovernedSpace } from './boot.ts';
import type { PlanStep, Thread } from './thread.ts';
import { type LandStatus, REASON_FOR, GovernedTurn } from './turn-core.ts';
import type { StateId } from '@si/states';

export type TurnResult = {
  readonly turnId: string;
  readonly state: Exclude<LandStatus, 'partially-completed'> | 'partially-completed';
};

export { REASON_FOR };

export const slugOf = (text: string): string => {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'note';
};

const titleOf = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 90 ? `${line.slice(0, 87)}...` : line || 'Untitled note';
};

/** The note this turn writes. Content is derived only from the request, never from a model. */
export const noteFor = (text: string): string =>
  [
    `# ${titleOf(text)}`,
    '',
    text.trim(),
    '',
    '---',
    '',
    `Written by ${SIGNATURE.product} after a human signature over the rehearsed change.`,
    SIGNATURE.mark,
    '',
  ].join('\n');

export class TurnRunner extends GovernedTurn {
  constructor(space: GovernedSpace, thread: Thread, approvals: ApprovalDesk, now: () => number = Date.now) {
    super(space, thread, approvals, now);
  }

  /** Starts a turn and returns immediately; the Thread is the channel the client follows. */
  start(text: string): { turnId: string } {
    const turnId = randomId(6);
    this.thread.append({
      type: 'message',
      turnId,
      actor: 'user',
      text,
      conf: this.space.config.policyCeiling,
      integrity: 'user',
    });
    void this.run(turnId, text).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.thread.append({ type: 'notice', turnId, text: say.failed('TurnRunner', message), tone: 'danger' });
      this.state(turnId, 'node', 'failed' satisfies StateId);
    });
    return { turnId };
  }

  private async run(turnId: string, text: string): Promise<void> {
    const { gw, orders, agent, config } = this.space;
    const path = `notes/${slugOf(text)}.md`;
    const content = noteFor(text);
    const authorityBase: Omit<OrderAuthority, 'scope' | 'changeSetHash'> = {
      spaceId: config.id,
      policyVersion: 'si-1',
      budget: { toolCalls: 40, tokens: 20_000 },
      successChecks: [`content-matches:${path}`],
      labelCeiling: config.policyCeiling,
    };

    this.state(turnId, 'frame', 'framed');

    const planSteps: PlanStep[] = [
      {
        id: 'rehearse-write',
        title: `Rehearse ${path} in the shadow copy`,
        tool: 'shadow.write',
        effectClass: 'sandbox',
        recoveryClass: 'R1',
        resource: `shadow:${path}`,
      },
      {
        id: 'commit-write',
        title: `Write ${path} after your signature`,
        tool: 'fs.write',
        effectClass: 'live',
        recoveryClass: 'R1',
        resource: `fs:${path}`,
      },
    ];

    const sandboxScope: ScopeEntry[] = [
      { tool: 'fs.read', ops: ['read'], resource: `fs:${path}` },
      { tool: 'shadow.read', ops: ['read'], resource: `shadow:${path}` },
      { tool: 'shadow.write', ops: ['write'], resource: `shadow:${path}` },
    ];

    const rev0: OrderRevision = makeRevision(`${config.id}-${turnId}`, 0, { ...authorityBase, scope: sandboxScope }, {
      phase: 'rehearse',
      path,
    });
    orders.activateSandboxOnly(rev0, gw.manifests);
    gw.activateBudget(rev0);
    const session0 = this.session(rev0, agent.publicB64, 'REHEARSE', gw.mintGrants(rev0, agent.publicB64));

    this.state(turnId, 'rehearse', 'rehearsing');
    const rehearsal = new Rehearsal(gw.broker(session0), 'rehearse');
    await rehearsal.stageWrite(path, content);
    const cs = rehearsal.build();
    const integrity = verifyChangeSetIntegrity(cs);
    if (integrity) throw new Error(integrity);

    this.thread.append({ type: 'plan', turnId, steps: planSteps, changeSetHash: cs.hash });

    await this.land({ turnId, changeSet: cs, rev0, authorityBase });
  }
}
