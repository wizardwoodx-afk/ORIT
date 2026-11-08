import {
  type Conf,
  type KeyPair,
  type Op,
  canonicalize,
  publicKeyFromB64,
  sha256hex,
  signString,
  verifyString,
} from '@si/core';
import { patternSubset } from '@si/grants';
import type { ManifestRegistry } from './manifest.ts';

export interface ScopeEntry {
  tool: string;
  ops: Op[];
  resource: string;
}
export interface OrderAuthority {
  spaceId: string;
  policyVersion: string;
  scope: ScopeEntry[];
  budget: { toolCalls: number; tokens: number };
  /** Part of authority on purpose: the agent may not weaken its own judge. */
  successChecks: string[];
  /** Humans sign over the exact rehearsed outcome, not an intention. */
  changeSetHash?: string;
  labelCeiling: Conf;
}
export interface OrderSignature {
  keyId: string;
  sig: string;
}
export interface OrderRevision {
  orderId: string;
  rev: number;
  parentRevHash?: string;
  authority: OrderAuthority;
  /** Changing only the plan never needs a new signature (replan class A). */
  plan: unknown;
  authorityHash: string;
  planHash: string;
  signatures: OrderSignature[];
}

export const authorityHashOf = (a: OrderAuthority): string => sha256hex(canonicalize(a));
export const revisionHash = (r: OrderRevision): string => sha256hex(canonicalize({ o: r.orderId, r: r.rev, a: r.authorityHash, p: r.planHash }));

export function makeRevision(
  orderId: string,
  rev: number,
  authority: OrderAuthority,
  plan: unknown,
  parent?: OrderRevision,
): OrderRevision {
  return {
    orderId,
    rev,
    ...(parent ? { parentRevHash: revisionHash(parent) } : {}),
    authority,
    plan,
    authorityHash: authorityHashOf(authority),
    planHash: sha256hex(canonicalize(plan)),
    signatures: [],
  };
}

const signingPayload = (r: OrderRevision) => canonicalize({ orderId: r.orderId, rev: r.rev, authorityHash: r.authorityHash });

/** Only a registered human key can produce a signature the registry accepts. */
export function humanSign(r: OrderRevision, key: KeyPair): OrderSignature {
  return { keyId: key.id, sig: signString(key.privateKey, signingPayload(r)) };
}

export type ReplanClass = 'A' | 'B' | 'C';

/** A: plan only. C: narrower authority. B: anything that needs new authority, including changed checks. */
export function classifyReplan(prev: OrderRevision, next: OrderRevision): ReplanClass {
  if (prev.authorityHash === next.authorityHash) return 'A';
  const a = prev.authority;
  const b = next.authority;
  const sameChecks = JSON.stringify([...a.successChecks].sort()) === JSON.stringify([...b.successChecks].sort());
  const scopeNarrower = b.scope.every((n) =>
    a.scope.some((p) => p.tool === n.tool && n.ops.every((o) => p.ops.includes(o)) && patternSubset(n.resource, p.resource)),
  );
  const budgetNarrower = b.budget.toolCalls <= a.budget.toolCalls && b.budget.tokens <= a.budget.tokens;
  const sameSpace = a.spaceId === b.spaceId && a.policyVersion === b.policyVersion;
  return sameChecks && scopeNarrower && budgetNarrower && sameSpace && b.changeSetHash === a.changeSetHash ? 'C' : 'B';
}

export class OrderRegistry {
  private readonly active = new Map<string, OrderRevision>();
  constructor(
    private readonly humanKeys: ReadonlyMap<string, string>,
    private readonly requiredApprovals = 1,
  ) {}

  humanPubB64(keyId: string): string | undefined {
    return this.humanKeys.get(keyId);
  }

  private validateStructure(r: OrderRevision): void {
    if (authorityHashOf(r.authority) !== r.authorityHash) throw new Error('order: authority hash mismatch');
    if (sha256hex(canonicalize(r.plan)) !== r.planHash) throw new Error('order: plan hash mismatch');
    const cur = this.active.get(r.orderId);
    if (!cur && r.rev > 1) throw new Error('order: no active parent');
    if (cur) {
      if (r.rev <= cur.rev) throw new Error('order: revision must increase');
      if (r.parentRevHash !== revisionHash(cur)) throw new Error('order: parent link mismatch');
    }
  }

  /** Human-signed activation. Requires distinct valid signatures from registered human keys. */
  activate(r: OrderRevision): void {
    this.validateStructure(r);
    const good = new Set<string>();
    for (const s of r.signatures) {
      const pub = this.humanKeys.get(s.keyId);
      if (pub && verifyString(publicKeyFromB64(pub), signingPayload(r), s.sig)) good.add(s.keyId);
    }
    if (good.size < this.requiredApprovals) throw new Error('order: not enough valid human signatures');
    this.active.set(r.orderId, r);
  }

  /** System activation for rehearsal: allowed only when every tool in scope is read-only or sandbox-only. */
  activateSandboxOnly(r: OrderRevision, manifests: ManifestRegistry): void {
    this.validateStructure(r);
    for (const s of r.authority.scope) {
      const m = manifests.get(s.tool);
      if (!m || (m.effectClass !== 'none' && m.effectClass !== 'sandbox')) throw new Error('order: scope has live effects, human signature required');
    }
    this.active.set(r.orderId, r);
  }

  isActive(orderId: string, rev: number, authorityHash: string): boolean {
    const cur = this.active.get(orderId);
    return cur !== undefined && cur.rev === rev && cur.authorityHash === authorityHash;
  }

  current(orderId: string): OrderRevision | undefined {
    return this.active.get(orderId);
  }
}
