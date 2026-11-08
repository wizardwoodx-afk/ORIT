/**
 * SelfImpulse — turns.
 *
 * One turn is Frame, Probe, Rehearse, Commit, Prove, Retain. The planner here is deterministic and
 * local: it turns a request into a real ChangeSet against a shadow copy, stops at a human signature,
 * then replays exactly what was signed through the gateway. No model is called, so nothing is
 * pretending to be intelligence; the governance path is what this exercises.
 */
import { type ToolCall, randomId, signString } from '@si/core';
import { type Check, Rehearsal, commitChangeSet, prove, scopeForChangeSet, verifyChangeSetIntegrity } from '@si/changeset';
import type { Broker, Detent, OrderAuthority, OrderRevision, ScopeEntry, Session } from '@si/gateway';
import { approvalPayload, argsHashOf, humanSign, makeRevision } from '@si/gateway';
import { SIGNATURE, say } from '@si/voice';
import type { ApprovalDesk } from './approvals.ts';
import type { GovernedSpace } from './boot.ts';
import type { NewEvent, PlanStep, Thread } from './thread.ts';
import type { StateId } from '@si/states';

export interface TurnResult {
  readonly turnId: string;
  readonly state: 'completed' | 'cancelled' | 'expired' | 'failed' | 'drifted';
}

const slugOf = (text: string): string => {
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
const noteFor = (text: string): string =>
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

export class TurnRunner {
  constructor(
    private readonly space: GovernedSpace,
    private readonly thread: Thread,
    readonly approvals: ApprovalDesk,
    private readonly now: () => number = Date.now,
  ) {}

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
      this.state(turnId, 'node', 'failed');
    });
    return { turnId };
  }

  private state(turnId: string, nodeId: string, state: StateId): void {
    const event: NewEvent = {
      type: 'state',
      turnId,
      nodeId,
      state,
      reason: REASON_FOR[state],
    };
    this.thread.append(event);
  }

  private async run(turnId: string, text: string): Promise<void> {
    const { gw, orders, human, agent, config } = this.space;
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

    const rev0 = makeRevision(`${config.id}-${turnId}`, 0, { ...authorityBase, scope: sandboxScope }, {
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

    const expiresAt = this.now() + 5 * 60_000;
    const request = this.approvals.request(
      {
        turnId,
        effect: 'write',
        target: path,
        paths: cs.ops.map((o) => o.path),
        changeSetHash: cs.hash,
        recoveryClass: 'R1',
        risk: 'reversible from stored before-content',
        dataClass: config.policyCeiling,
        expiresAt,
      },
      this.now(),
    );
    this.thread.append({ type: 'approval', turnId, approval: request.view });
    this.state(turnId, 'approve', 'needs-approval');

    const decision = await request.decided;
    if (decision === 'denied') {
      this.state(turnId, 'approve', 'cancelled');
      this.thread.append({ type: 'notice', turnId, text: say.cancelled(), tone: 'info' });
      this.space.ledger.append('approval.denied', 'human', { turnId, changeSetHash: cs.hash });
      return;
    }
    if (decision === 'expired') {
      this.state(turnId, 'approve', 'expired');
      this.thread.append({ type: 'notice', turnId, text: say.expired(), tone: 'attn' });
      return;
    }

    this.space.ledger.append('approval.signed', human.id, { turnId, changeSetHash: cs.hash });

    // Class B: the human signed over the exact rehearsed outcome, so the revision carries its hash.
    const rev1 = makeRevision(
      rev0.orderId,
      1,
      { ...authorityBase, scope: scopeForChangeSet(cs), changeSetHash: cs.hash },
      { phase: 'commit', paths: cs.ops.map((o) => o.path), changeSetHash: cs.hash },
      rev0,
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
      return;
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

    const passed = report.checks.filter((c) => c.pass).length;
    const final = report.verdict === 'verified' ? 'completed' : 'partially-completed';
    this.state(turnId, 'prove', final);
    this.thread.append({
      type: 'message',
      turnId,
      actor: 'assistant',
      text: say.done(commit.applied, passed, report.checks.length),
      conf: config.policyCeiling,
      integrity: 'trusted',
    });
  }

  private session(rev: OrderRevision, subjectPubB64: string, phase: Session['phase'], chains: Session['chains']): Session {
    return this.space.gw.openSession({
      orderId: rev.orderId,
      callerPubB64: subjectPubB64,
      dial: this.space.config.dial as Detent,
      phase,
      chains,
    });
  }
}

/** The reason line a state row carries. Kept next to the runner so a state cannot appear bare. */
const REASON_FOR: Readonly<Record<StateId, string>> = {
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
