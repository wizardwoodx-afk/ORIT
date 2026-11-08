import {
  type Conf,
  type KeyPair,
  type Label,
  type Phase,
  type ToolCall,
  BOTTOM_LABEL,
  ToolCallSchema,
  canonicalize,
  flowAllowed,
  joinLabels,
  keyIdOfPublic,
  publicKeyFromB64,
  randomId,
  sha256hex,
  verifyString,
} from '@si/core';
import { type Policy as ClassifierPolicy, classifyBuffer } from '@si/classifier';
import { type GrantChain, covers, mintRoot, verifyChain } from '@si/grants';
import type { Ledger } from '@si/ledger';
import { type Budget, BudgetMeter } from './budget.ts';
import { type Detent, dialMatrix } from './dial.ts';
import { ManifestRegistry, type ToolManifest } from './manifest.ts';
import type { OrderRegistry, OrderRevision } from './order.ts';
import { normalizeRelPath } from './paths.ts';
import { type PolicyBundle, denies } from './policy.ts';
import { type Ticket, TicketIssuer, TicketVerifier, argsHashOf } from './tickets.ts';
import type { Worker } from './workers.ts';

export interface Session {
  readonly id: string;
  readonly spaceId: string;
  readonly orderId: string;
  readonly callerKeyId: string;
  dial: Detent;
  phase: Phase;
  chains: GrantChain[];
  /** Join of everything this agent has seen. Updated by the gateway on every result, never by the brain. */
  contextLabel: Label;
}

export type Decision =
  | { kind: 'allow'; ticket: Ticket; manifest: ToolManifest; grantId: string }
  | { kind: 'ask'; reason: string; argsHash: string }
  | { kind: 'deny'; layer: string; reason: string };

export type ExecResult =
  | { kind: 'ok'; value: unknown; label: Label; receiptSeq: number; afterHash?: string | null }
  | { kind: 'ask'; reason: string; argsHash: string; callId: string }
  | { kind: 'denied'; layer: string; reason: string }
  | { kind: 'error'; message: string; name: string; receiptSeq: number };

export interface Broker {
  call(call: ToolCall): Promise<ExecResult>;
  readonly sessionId: string;
}

export interface Approval {
  kind: 'approve' | 'declassify';
  callId: string;
  argsHash: string;
  keyId: string;
  sig: string;
}
export const approvalPayload = (a: Pick<Approval, 'kind' | 'callId' | 'argsHash'>): string =>
  canonicalize({ kind: a.kind, callId: a.callId, argsHash: a.argsHash });

const PHASE_ALLOWS: Record<Phase, ReadonlySet<string>> = {
  FRAME: new Set(),
  PROBE: new Set(['none']),
  REHEARSE: new Set(['none', 'sandbox']),
  COMMIT: new Set(['none', 'sandbox', 'live', 'external']),
  PROVE: new Set(['none']),
  RETAIN: new Set(),
};

export interface GatewayDeps {
  spaceId: string;
  rootKey: KeyPair;
  gatewayKey: KeyPair;
  ledger: Ledger;
  orders: OrderRegistry;
  policy: PolicyBundle;
  classifierPolicy: ClassifierPolicy;
  workers: Worker[];
  manifests?: ManifestRegistry;
  now?: () => number;
  budget?: BudgetMeter;
  /** Deterministic second control for R2 actions. Timeout or error means "ask a human", never "allow". */
  guardian?: (call: ToolCall, m: ToolManifest, s: Session) => Promise<boolean>;
  /** Advisory only: may raise a requirement, can never lower one. */
  risk?: (call: ToolCall, m: ToolManifest) => { escalate: boolean };
  guardianTimeoutMs?: number;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

export class Gateway {
  readonly manifests: ManifestRegistry;
  readonly budget: BudgetMeter;
  private readonly now: () => number;
  private readonly issuer: TicketIssuer;
  private readonly workers = new Map<string, Worker>();
  private readonly approvals: Approval[] = [];
  private readonly revoked = new Set<string>();
  private killed = false;

  constructor(private readonly d: GatewayDeps) {
    this.now = d.now ?? Date.now;
    this.manifests = d.manifests ?? new ManifestRegistry();
    this.budget = d.budget ?? new BudgetMeter();
    this.issuer = new TicketIssuer(d.gatewayKey, this.now);
    for (const w of d.workers) this.workers.set(w.id, w);
  }

  /** Verifier handed to each worker so it can check tickets without trusting the brain. */
  ticketVerifierFor(workerId: string): TicketVerifier {
    return new TicketVerifier(this.issuer.publicB64, workerId, this.now);
  }

  openSession(o: { orderId: string; callerPubB64: string; dial: Detent; phase: Phase; chains?: GrantChain[] }): Session {
    return {
      id: randomId(8),
      spaceId: this.d.spaceId,
      orderId: o.orderId,
      callerKeyId: keyIdOfPublic(o.callerPubB64),
      dial: o.dial,
      phase: o.phase,
      chains: o.chains ?? [],
      contextLabel: BOTTOM_LABEL,
    };
  }

  /** Gateway-only: mint root grants for each scope entry of an ACTIVE revision. */
  mintGrants(rev: OrderRevision, subjectPubB64: string, ttlMs = 10 * 60_000): GrantChain[] {
    if (!this.d.orders.isActive(rev.orderId, rev.rev, rev.authorityHash)) throw new Error('mint: revision not active');
    const t = this.now();
    return rev.authority.scope.map((s) =>
      mintRoot(this.d.rootKey, {
        spaceId: this.d.spaceId,
        orderId: rev.orderId,
        rev: rev.rev,
        authorityHash: rev.authorityHash,
        tool: s.tool,
        ops: s.ops,
        resource: s.resource,
        subjectPubB64,
        notBefore: t - 1,
        expiresAt: t + ttlMs,
        labelCeiling: rev.authority.labelCeiling,
        maxDepth: 2,
        policyVersion: this.d.policy.version,
      }),
    );
  }

  activateBudget(rev: OrderRevision): void {
    this.budget.init(rev.orderId, rev.authority.budget);
    this.d.ledger.append('order.activated', 'gateway', {
      orderId: rev.orderId,
      rev: rev.rev,
      authorityHash: rev.authorityHash,
      changeSetHash: rev.authority.changeSetHash ?? null,
    });
  }

  /** Human approvals and declassifications arrive from the UI channel and are verified against registered human keys. */
  addApproval(a: Approval): boolean {
    const pub = this.d.orders.humanPubB64(a.keyId);
    if (!pub || !verifyString(publicKeyFromB64(pub), approvalPayload(a), a.sig)) return false;
    this.approvals.push(a);
    this.d.ledger.append('approval', a.keyId, { kind: a.kind, callId: a.callId, argsHash: a.argsHash });
    return true;
  }

  private hasApproval(kind: Approval['kind'], callId: string, argsHash: string): boolean {
    return this.approvals.some((a) => a.kind === kind && a.callId === callId && a.argsHash === argsHash);
  }

  broker(session: Session): Broker {
    return { sessionId: session.id, call: (c) => this.execute(session, c) };
  }

  async decide(session: Session, raw: ToolCall): Promise<Decision> {
    try {
      if (this.killed) return deny('kill', 'gateway killed');
      const parsed = ToolCallSchema.safeParse(raw);
      if (!parsed.success) return deny('schema', 'malformed tool call');
      const call = parsed.data;
      const m = this.manifests.get(call.tool);
      if (!m) return deny('manifest', 'unknown tool');
      const args = m.argsSchema.safeParse(call.args);
      if (!args.success) return deny('args', 'arguments rejected by tool schema');
      let resource: string;
      try {
        resource = m.resourceOf(args.data);
      } catch (e) {
        return deny('resource', (e as Error).message);
      }
      if (!PHASE_ALLOWS[session.phase].has(m.effectClass)) return deny('phase', `${m.effectClass} effects are not allowed in ${session.phase}`);
      if (m.actionClass !== 'read' && (session.phase === 'PROBE' || session.phase === 'PROVE')) return deny('phase', 'read-only phase');
      const pol = denies(this.d.policy, resource);
      if (pol) return deny('policy', `resource matches deny rule ${pol}`);

      if (m.pathArg) {
        const rel = normalizeRelPath(String(args.data[m.pathArg]));
        const c = classifyBuffer(rel, Buffer.alloc(0), 0, this.d.classifierPolicy);
        if (m.actionClass === 'read' && !c.agentMayRead) return deny('classifier', 'credential files are not readable by agents');
        if (m.actionClass !== 'read' && !c.agentMayEdit) return deny('classifier', 'file is protected from agent edits');
      }

      const grant = this.findGrant(session, m, resource);
      if (!grant.ok) return deny('grant', grant.reason);

      if (!flowAllowed(session.contextLabel, m.sinkConf)) {
        const argsHash = argsHashOf(args.data);
        if (!this.hasApproval('declassify', call.id, argsHash)) return deny('ifc', 'context is too sensitive for this sink; declassification required');
      }

      let verdict = dialMatrix(session.dial, m.effectClass, m.actionClass, m.recoveryClass);
      if (session.contextLabel.integrity === 'untrusted' && (m.effectClass === 'live' || m.effectClass === 'external') && verdict === 'allow') verdict = 'ask';
      if (verdict === 'deny') return deny('dial', `trust dial ${session.dial} does not permit this action`);
      if (verdict === 'guardian') {
        let ok = false;
        try {
          ok = this.d.guardian ? await withTimeout(this.d.guardian(call, m, session), this.d.guardianTimeoutMs ?? 3000) : false;
        } catch {
          ok = false;
        }
        verdict = ok ? 'allow' : 'ask';
      }
      if (this.d.risk?.(call, m).escalate && verdict === 'allow') verdict = 'ask';
      const argsHash = argsHashOf(args.data);
      if (verdict === 'ask' && !this.hasApproval('approve', call.id, argsHash)) {
        return { kind: 'ask', reason: 'needs your approval', argsHash };
      }
      if (!this.budget.reserve(session.orderId, { toolCalls: 1 })) return deny('budget', 'order budget exhausted');
      const ticket = this.issuer.issue({ grantId: grant.grantId, worker: m.worker, tool: m.name, resource, argsHash });
      return { kind: 'allow', ticket, manifest: m, grantId: grant.grantId };
    } catch {
      return deny('gateway', 'internal error, failing closed');
    }
  }

  private findGrant(s: Session, m: ToolManifest, resource: string): { ok: true; grantId: string } | { ok: false; reason: string } {
    let reason = 'no grant for this tool';
    for (const chain of s.chains) {
      const leaf0 = chain[chain.length - 1];
      if (!leaf0 || leaf0.tool !== m.name) continue;
      const v = verifyChain(chain, {
        rootPubB64: this.d.rootKey.publicB64,
        now: this.now(),
        spaceId: this.d.spaceId,
        isRevoked: (id) => this.revoked.has(id),
        isOrderActive: (o, r, h) => this.d.orders.isActive(o, r, h),
        policyVersion: this.d.policy.version,
      });
      if (!v.ok) {
        reason = v.reason;
        continue;
      }
      if (keyIdOfPublic(v.leaf.subjectPubB64) !== s.callerKeyId) {
        reason = 'grant holder does not match caller';
        continue;
      }
      const c = covers(v.leaf, { tool: m.name, op: m.op, resource, dataConf: s.contextLabel.conf });
      if (c.ok) return { ok: true, grantId: v.leaf.grantId };
      reason = c.reason;
    }
    return { ok: false, reason };
  }

  async execute(session: Session, raw: ToolCall): Promise<ExecResult> {
    const d = await this.decide(session, raw);
    const callId = typeof raw?.id === 'string' ? raw.id : 'unknown';
    const base = { sessionId: session.id, callId, tool: raw?.tool, phase: session.phase, dial: session.dial };
    if (d.kind === 'deny') {
      this.d.ledger.append('decision', 'gateway', { ...base, verdict: 'deny', layer: d.layer, reason: d.reason });
      return { kind: 'denied', layer: d.layer, reason: d.reason };
    }
    if (d.kind === 'ask') {
      this.d.ledger.append('decision', 'gateway', { ...base, verdict: 'ask', argsHash: d.argsHash });
      return { kind: 'ask', reason: d.reason, argsHash: d.argsHash, callId };
    }
    this.d.ledger.append('decision', 'gateway', { ...base, verdict: 'allow', ticketId: d.ticket.id, grantId: d.grantId, resource: d.ticket.resource });
    const worker = this.workers.get(d.manifest.worker);
    if (!worker) return { kind: 'denied', layer: 'worker', reason: 'no worker registered' };
    const parsedArgs = d.manifest.argsSchema.parse(raw.args);
    const key = sha256hex(`${session.orderId}|${raw.nodeId}|${raw.step}|${d.ticket.argsHash}`);
    try {
      this.d.ledger.writeIntent(key, callId, d.ticket.id);
    } catch {
      return { kind: 'denied', layer: 'idempotency', reason: 'duplicate call key' };
    }
    try {
      const out = await worker.run(d.ticket, d.manifest, parsedArgs);
      const outHash = sha256hex(canonicalize({ after: out.afterHash ?? null, tool: d.manifest.name }));
      this.d.ledger.writeOutcome(key, outHash);
      const ev = this.d.ledger.append('outcome', 'gateway', {
        ...base,
        ok: true,
        resource: d.ticket.resource,
        recoveryClass: d.manifest.recoveryClass,
        effectClass: d.manifest.effectClass,
        afterHash: out.afterHash ?? null,
        grantId: d.grantId,
      });
      const label = this.labelResult(d.manifest, parsedArgs, d.ticket.resource, out.value);
      session.contextLabel = joinLabels(session.contextLabel, label);
      return { kind: 'ok', value: out.value, label, receiptSeq: ev.seq, afterHash: out.afterHash ?? null };
    } catch (e) {
      const err = e as Error;
      this.d.ledger.writeOutcome(key, sha256hex(`error:${err.name}`));
      const ev = this.d.ledger.append('outcome', 'gateway', { ...base, ok: false, error: err.name, resource: d.ticket.resource });
      return { kind: 'error', message: err.message, name: err.name, receiptSeq: ev.seq };
    }
  }

  private labelResult(m: ToolManifest, args: Record<string, unknown>, resource: string, value: unknown): Label {
    if (m.actionClass === 'read' && m.pathArg && typeof value === 'object' && value !== null && 'content' in value) {
      const v = value as { content: string; size: number; hash: string };
      const c = classifyBuffer(String(args[m.pathArg]), Buffer.from(v.content).subarray(0, 65536), v.size, this.d.classifierPolicy);
      const conf: Conf = v.size > 65536 ? 'restricted' : c.conf; // unscanned tail: assume the worst
      return { conf, integrity: 'tool', provenance: [`${resource}@${v.hash.slice(0, 12)}`] };
    }
    return { conf: 'public', integrity: 'tool', provenance: [resource] };
  }

  /** Real kill: revoke, terminate workers, verify nothing remains. */
  async kill(): Promise<{ remainingWorkers: number }> {
    this.killed = true;
    let remaining = 0;
    for (const w of this.workers.values()) remaining += (await w.terminateAll()).remaining;
    this.d.ledger.append('kill', 'gateway', { remainingWorkers: remaining });
    return { remainingWorkers: remaining };
  }

  revoke(revocationId: string): void {
    this.revoked.add(revocationId);
  }
}

const deny = (layer: string, reason: string): Decision => ({ kind: 'deny', layer, reason });
export type { Budget };
