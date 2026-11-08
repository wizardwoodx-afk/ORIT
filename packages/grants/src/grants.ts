import {
  type Conf,
  type KeyPair,
  type Op,
  canonicalize,
  confRank,
  keyIdOfPublic,
  publicKeyFromB64,
  randomId,
  signString,
  verifyString,
} from '@si/core';
import { matchesResource, patternSubset } from './resource.ts';

export interface GrantBody {
  v: 1;
  grantId: string;
  parentId?: string;
  issuerKeyId: string;
  subjectPubB64: string;
  spaceId: string;
  orderId: string;
  rev: number;
  authorityHash: string;
  tool: string;
  ops: Op[];
  resource: string;
  notBefore: number;
  expiresAt: number;
  maxUses?: number;
  labelCeiling: Conf;
  depth: number;
  maxDepth: number;
  policyVersion: string;
  revocationId: string;
}
export interface GrantBlock extends GrantBody {
  sig: string;
}
export type GrantChain = readonly GrantBlock[];

export interface MintParams {
  spaceId: string;
  orderId: string;
  rev: number;
  authorityHash: string;
  tool: string;
  ops: Op[];
  resource: string;
  subjectPubB64: string;
  notBefore: number;
  expiresAt: number;
  maxUses?: number;
  labelCeiling: Conf;
  maxDepth: number;
  policyVersion: string;
}

const bodyOf = ({ sig: _sig, ...body }: GrantBlock): GrantBody => body;
const sign = (key: KeyPair, body: GrantBody): GrantBlock => ({ ...body, sig: signString(key.privateKey, canonicalize(body)) });

/** Only the gateway holds the Space root key, and only calls this after a human-signed Order revision. */
export function mintRoot(rootKey: KeyPair, p: MintParams): GrantChain {
  const body: GrantBody = {
    v: 1,
    grantId: randomId(),
    issuerKeyId: rootKey.id,
    ...p,
    depth: 0,
    revocationId: randomId(8),
  };
  return [sign(rootKey, body)];
}

export type Narrowing = Partial<
  Pick<MintParams, 'tool' | 'ops' | 'resource' | 'notBefore' | 'expiresAt' | 'maxUses' | 'labelCeiling'>
> & { subjectPubB64: string };

/** The current holder delegates a strictly narrower grant to another agent, signed with the holder's own key. */
export function delegate(chain: GrantChain, holderKey: KeyPair, n: Narrowing): GrantChain {
  const parent = chain[chain.length - 1];
  if (!parent) throw new Error('delegate: empty chain');
  if (keyIdOfPublic(parent.subjectPubB64) !== holderKey.id) throw new Error('delegate: signer is not the holder');
  const body: GrantBody = {
    ...bodyOf(parent),
    ...n,
    grantId: randomId(),
    parentId: parent.grantId,
    issuerKeyId: holderKey.id,
    depth: parent.depth + 1,
    revocationId: randomId(8),
  };
  return [...chain, sign(holderKey, body)];
}

export interface VerifyOptions {
  rootPubB64: string;
  now: number;
  spaceId: string;
  isRevoked: (revocationId: string) => boolean;
  isOrderActive: (orderId: string, rev: number, authorityHash: string) => boolean;
  policyVersion: string;
}

export type ChainVerdict = { ok: true; leaf: GrantBlock } | { ok: false; reason: string };

const subsetOps = (child: Op[], parent: Op[]) => child.every((o) => parent.includes(o));

export function verifyChain(chain: GrantChain, o: VerifyOptions): ChainVerdict {
  const first = chain[0];
  if (!first) return { ok: false, reason: 'empty chain' };
  const rootPub = publicKeyFromB64(o.rootPubB64);
  let prev: GrantBlock | undefined;
  for (const [i, b] of chain.entries()) {
    const issuerPub = prev ? publicKeyFromB64(prev.subjectPubB64) : rootPub;
    const expectedIssuer = prev ? keyIdOfPublic(prev.subjectPubB64) : keyIdOfPublic(o.rootPubB64);
    if (b.issuerKeyId !== expectedIssuer) return { ok: false, reason: `hop ${i}: wrong issuer` };
    if (!verifyString(issuerPub, canonicalize(bodyOf(b)), b.sig)) return { ok: false, reason: `hop ${i}: bad signature` };
    if (b.depth !== i || b.depth > b.maxDepth) return { ok: false, reason: `hop ${i}: depth` };
    if (b.spaceId !== o.spaceId) return { ok: false, reason: `hop ${i}: wrong space` };
    if (b.policyVersion !== o.policyVersion) return { ok: false, reason: `hop ${i}: stale policy` };
    if (o.isRevoked(b.revocationId)) return { ok: false, reason: `hop ${i}: revoked` };
    if (o.now < b.notBefore || o.now >= b.expiresAt) return { ok: false, reason: `hop ${i}: not valid at this time` };
    if (prev) {
      if (b.parentId !== prev.grantId) return { ok: false, reason: `hop ${i}: parent link` };
      if (b.orderId !== prev.orderId || b.rev !== prev.rev || b.authorityHash !== prev.authorityHash || b.maxDepth !== prev.maxDepth)
        return { ok: false, reason: `hop ${i}: order binding changed` };
      if (b.tool !== prev.tool) return { ok: false, reason: `hop ${i}: tool widened` };
      if (!subsetOps(b.ops, prev.ops)) return { ok: false, reason: `hop ${i}: ops widened` };
      if (!patternSubset(b.resource, prev.resource)) return { ok: false, reason: `hop ${i}: resource widened` };
      if (b.expiresAt > prev.expiresAt || b.notBefore < prev.notBefore) return { ok: false, reason: `hop ${i}: validity widened` };
      if (confRank(b.labelCeiling) > confRank(prev.labelCeiling)) return { ok: false, reason: `hop ${i}: label ceiling raised` };
      if (prev.maxUses !== undefined && (b.maxUses === undefined || b.maxUses > prev.maxUses))
        return { ok: false, reason: `hop ${i}: uses widened` };
    }
    prev = b;
  }
  const leaf = chain[chain.length - 1] as GrantBlock;
  if (!o.isOrderActive(leaf.orderId, leaf.rev, leaf.authorityHash)) return { ok: false, reason: 'order revision not active' };
  return { ok: true, leaf };
}

export interface GrantRequest {
  tool: string;
  op: Op;
  resource: string;
  dataConf: Conf;
}

export function covers(leaf: GrantBlock, r: GrantRequest): { ok: true } | { ok: false; reason: string } {
  if (leaf.tool !== r.tool) return { ok: false, reason: 'tool not granted' };
  if (!leaf.ops.includes(r.op)) return { ok: false, reason: 'op not granted' };
  if (!matchesResource(leaf.resource, r.resource)) return { ok: false, reason: 'resource not granted' };
  if (confRank(r.dataConf) > confRank(leaf.labelCeiling)) return { ok: false, reason: 'data label above grant ceiling' };
  return { ok: true };
}
