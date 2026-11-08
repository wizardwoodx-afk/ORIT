/**
 * SelfImpulse — the governed landing.
 *
 * One path from "a rehearsed change exists" to "the world changed and there is a receipt". The
 * deterministic planner and the model-driven brain both end here, on purpose: a model must not be able
 * to reach a weaker commit path than a template can, and a template must not get a stronger one.
 *
 * Approval, revision escalation, per-call authorisation, compare-and-swap commit, prove, receipts,
 * seal, and the closing message all live in this file. Nothing else does.
 */
import { type Check, type ChangeSet, commitChangeSet, prove, scopeForChangeSet } from '@si/changeset';
import type { Broker, Detent, OrderAuthority, OrderRevision, Session } from '@si/gateway';
import { approvalPayload, argsHashOf, humanSign, makeRevision } from '@si/gateway';
import { type ToolCall, signString } from '@si/core';
import type { StateId } from '@si/states';
import type { ApprovalDesk, Decision } from './approvals.ts';
import type { GovernedSpace } from './boot.ts';
import type { ApprovalView, NewEvent, Thread } from './thread.ts';
import { say } from '@si/voice';

export type LandStatus = 'completed' | 'cancelled' | 'expired' | 'failed' | 'drifted' | 'partially-completed';

export interface LandInput {
  readonly turnId: string;
  readonly changeSet: ChangeSet;
  /** The revision the rehearsal ran under. The signed revision is built from it. */
  readonly rev0: OrderRevision;
  readonly authorityBase: Omit<OrderAuthority, 'scope' | 'changeSetHash'>;
  /** The assistant's closing words. Omitted by a template turn, which uses the receipt summary. */
  readonly finalText?: string;
  /** Approval expiry, in milliseconds from now. */
  readonly ttlMs?: number;
}

/** The reason line a state row carries. Kept next to the runner so a state cannot appear bare. */
export const REASON_FOR: Readonly<Record<StateId, string>> = {
  draft: 'Nothing has run yet.',
  framed: 'The plan is written; it is not approved.',
  'needs-approval': 'Waiting for a human signature on the exact effect.',
  rehearsing: 'Running against a shadow copy. Nothing here is real yet.',
  'ready-to-commit': 'The rehearsal matched; commit will replay it.',
  running: 'Replaying the signed ChangeSet through the gateway.',
  verifying: 'Re-reading the live files and re-running the checks.',
  completed: 'Done, with a receipt.',
  blocked: 'Stopped by a rule or a missing prerequisite.',
  failed: 'It did not work. The reason is attached.',
  cancelled: 'You stopped it before it finished.',
  expired: 'The approval window closed.',
  'rolled-back': 'The change was undone and verified by hash.',
  'partially-completed': 'Some effects landed. The rest did not.',
  drifted: 'The world changed between rehearsal and commit.',
};

export class GovernedTurn {
  constructor(
    protected readonly space: GovernedSpace,
    protected readonly thread: Thread,
    readonly approvals: ApprovalDesk,
    protected readonly now: () => number = Date.now,
  ) {}

  /** A state row always carries a reason. It is the vocabulary's line unless this turn knows better. */
  protected state(turnId: string, nodeId: string, state: StateId, reason?: string): void {
    const event: NewEvent = { type: 'state', turnId, nodeId, state, reason: reason ?? REASON_FOR[state] };
    this.thread.append(event);
  }

  protected session(
    rev: OrderRevision,
    subjectPubB64: string,
    phase: Session['phase'],
    chains: Session['chains'],
  ): Session {
    return this.space.gw.openSession({
      orderId: rev.orderId,
      callerPubB64: subjectPubB64,
      dial: this.space.config.dial as Detent,
      phase,
      chains,
    });
  }

  protected requestApproval(input: LandInput): { view: ApprovalView; decided: Promise<Decision> } {
    const cs = input.changeSet;
    const expiresAt = this.now() + (input.ttlMs ?? 5 * 60_000);
    const request = this.approvals.request(
      {
        turnId: input.turnId,
        effect: 'write',
        target: cs.ops[0]?.path ?? '',
        paths: cs.ops.map((op) => op.path),
        changeSetHash: cs.hash,
        recoveryClass: 'R1',
        risk: 'reversible from stored before-content',
        dataClass: this.space.config.policyCeiling,
        expiresAt,
      },
      this.now(),
    );
    this.thread.append({ type: 'approval', turnId: input.turnId, approval: request.view });
    this.state(input.turnId, 'approve', 'needs-approval');
    return request;
  }

  /** Approval to receipt. Returns the state the turn ended in, and appends every event as it happens. */
  protected async land(input: LandInput): Promise<LandStatus> {
    const { gw, orders, human, agent, config } = this.space;
    const cs = input.changeSet;
    const { turnId } = input;

    const request = this.requestApproval(input);
    const decision = await request.decided;
    if (decision === 'denied') {
      this.state(turnId, 'approve', 'cancelled');
      this.thread.append({ type: 'notice', turnId, text: say.cancelled(), tone: 'info' });
      this.space.ledger.append('approval.denied', 'human', { turnId, changeSetHash: cs.hash });
      return 'cancelled';
    }
    if (decision === 'expired') {
      this.state(turnId, 'approve', 'expired');
      this.thread.append({ type: 'notice', turnId, text: say.expired(), tone: 'attn' });
      return 'expired';
    }

    this.space.ledger.append('approval.signed', human.id, { turnId, changeSetHash: cs.hash });

    // Class B: the human signed over the exact rehearsed outcome, so the revision carries its hash.
    const rev1 = makeRevision(
      input.rev0.orderId,
      1,
      { ...input.authorityBase, scope: scopeForChangeSet(cs), changeSetHash: cs.hash },
      { phase: 'commit', paths: cs.ops.map((o) => o.path), changeSetHash: cs.hash },
      input.rev0,
    );
    rev1.signatures.push(humanSign(rev1, human));
    orders.activate(rev1);
    gw.activateBudget(rev1);
    const session1 = this.session(rev1, agent.publicB64, 'COMMIT', gw.mintGrants(rev1, agent.publicB64));

    this.state(turnId, 'commit', 'running');
    // A Space whose trust dial asks per live edit gets a signature bound to that exact call and its
    // argument hash. The harness holds the human key in this build; the keychain takes it at release.
    const authorize = (call: ToolCall): void => {
      const argsHash = argsHashOf(call.args);
      const sig = signString(human.privateKey, approvalPayload({ kind: 'approve', callId: call.id, argsHash }));
      gw.addApproval({ kind: 'approve', callId: call.id, argsHash, keyId: human.id, sig });
    };
    const commit = await commitChangeSet(gw.broker(session1), cs, 'commit', authorize);

    if (commit.status !== 'committed') {
      const state = commit.status === 'drifted' ? 'drifted' : 'failed';
      this.state(turnId, 'commit', state);
      this.thread.append({
        type: 'notice',
        turnId,
        text: commit.status === 'drifted' ? say.doneWithDrift(commit.drifted) : say.failed('Commit', commit.reason ?? 'unknown'),
        tone: 'danger',
      });
      return commit.status === 'drifted' ? 'drifted' : 'failed';
    }

    this.state(turnId, 'prove', 'verifying');
    session1.phase = 'PROVE';
    const broker1: Broker = gw.broker(session1);
    const checks: Check[] = cs.ops.map((op) => ({
      id: `content-matches:${op.path}`,
      run: async (view) => {
        const actual = await view.read(op.path);
        const pass = actual === op.after;
        return { pass, detail: pass ? 'content matches the rehearsed hash' : 'content differs from the rehearsal' };
      },
    }));
    const report = await prove(broker1, cs, checks);

    for (const [index, seq] of commit.receipts.entries()) {
      const event = this.space.ledger.events(seq, seq)[0];
      const op = cs.ops[index];
      if (!event || !op) continue;
      this.thread.append({
        type: 'receipt',
        turnId,
        receipt: {
          seq: index + 1,
          effect: 'write',
          target: op.path,
          recoveryClass: 'R1',
          grantId: String(event.body.grantId ?? ''),
          afterHash: op.afterHash,
          hash: event.hash,
          ledgerSeq: event.seq,
        },
      });
    }
    for (const check of report.checks) this.thread.append({ type: 'check', turnId, ...check });

    const head = this.space.ledger.seal(this.space.witness);
    if (head) this.thread.append({ type: 'notice', turnId, text: say.receipt(head.toSeq, head.root), tone: 'info' });

    const passed = report.checks.filter((entry) => entry.pass).length;
    const final: LandStatus = report.verdict === 'verified' ? 'completed' : 'partially-completed';
    this.state(turnId, 'prove', final);
    this.thread.append({
      type: 'message',
      turnId,
      actor: 'assistant',
      text: input.finalText ?? say.done(commit.applied, passed, report.checks.length),
      conf: config.policyCeiling,
      integrity: 'trusted',
    });
    return final;
  }
}
