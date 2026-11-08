import { describe, expect, it } from 'vitest';
import { newKeyPair } from '@si/core';
import { type MintParams, covers, delegate, matchesResource, mintRoot, patternSubset, verifyChain } from '../src/index.ts';

const root = newKeyPair();
const holder = newKeyPair();
const child = newKeyPair();
const NOW = 1_000_000;

const params = (over: Partial<MintParams> = {}): MintParams => ({
  spaceId: 's1', orderId: 'o1', rev: 1, authorityHash: 'h', tool: 'fs.write', ops: ['write', 'read'],
  resource: 'fs:src/**', subjectPubB64: holder.publicB64, notBefore: NOW - 1, expiresAt: NOW + 1000,
  labelCeiling: 'confidential', maxDepth: 2, policyVersion: 'p1', ...over,
});
const opts = (over = {}) => ({
  rootPubB64: root.publicB64, now: NOW, spaceId: 's1', policyVersion: 'p1',
  isRevoked: () => false, isOrderActive: () => true, ...over,
});

describe('resource patterns', () => {
  it('matches prefixes and rejects traversal', () => {
    expect(matchesResource('fs:src/**', 'fs:src/a/b.ts')).toBe(true);
    expect(matchesResource('fs:src/**', 'fs:srcx/a.ts')).toBe(false);
    expect(matchesResource('fs:src/**', 'fs:src/../etc')).toBe(false);
    expect(patternSubset('fs:src/a/**', 'fs:src/**')).toBe(true);
    expect(patternSubset('fs:**'.replace('**', 'x/**'), 'fs:src/**')).toBe(false);
  });
});

describe('grant chains', () => {
  it('verifies a root grant and a narrower delegation', () => {
    const c = mintRoot(root, params());
    expect(verifyChain(c, opts()).ok).toBe(true);
    const d = delegate(c, holder, { subjectPubB64: child.publicB64, ops: ['write'], resource: 'fs:src/a/**', expiresAt: NOW + 500 });
    const v = verifyChain(d, opts());
    expect(v.ok).toBe(true);
  });

  it.each([
    ['ops', { ops: ['write', 'delete'] as never }],
    ['resource', { resource: 'fs:**'.replace('**', 'lib/**') }],
    ['expiry', { expiresAt: NOW + 5000 }],
    ['label ceiling', { labelCeiling: 'restricted' as const }],
  ])('rejects widening %s', (_n, over) => {
    const c = mintRoot(root, params());
    const d = delegate(c, holder, { subjectPubB64: child.publicB64, ...over });
    expect(verifyChain(d, opts()).ok).toBe(false);
  });

  it('rejects a delegation signed by someone who is not the holder', () => {
    const c = mintRoot(root, params());
    expect(() => delegate(c, child, { subjectPubB64: child.publicB64 })).toThrow();
  });

  it('rejects forged roots, expired, revoked, stale policy, wrong space and inactive orders', () => {
    const c = mintRoot(root, params());
    const forged = mintRoot(newKeyPair(), params());
    expect(verifyChain(forged, opts()).ok).toBe(false);
    expect(verifyChain(c, opts({ now: NOW + 2000 })).ok).toBe(false);
    expect(verifyChain(c, opts({ isRevoked: () => true })).ok).toBe(false);
    expect(verifyChain(c, opts({ policyVersion: 'p2' })).ok).toBe(false);
    expect(verifyChain(c, opts({ spaceId: 's2' })).ok).toBe(false);
    expect(verifyChain(c, opts({ isOrderActive: () => false })).ok).toBe(false);
  });

  it('detects tampering with a signed block', () => {
    const c = mintRoot(root, params());
    const tampered = [{ ...(c[0] as NonNullable<(typeof c)[0]>), resource: 'fs:**'.replace('**', '**') }];
    tampered[0] = { ...tampered[0], ops: ['write', 'read', 'delete'] } as never;
    expect(verifyChain(tampered, opts()).ok).toBe(false);
  });

  it('covers() enforces tool, op, resource and label ceiling', () => {
    const leaf = (mintRoot(root, params())[0]) as never;
    expect(covers(leaf, { tool: 'fs.write', op: 'write', resource: 'fs:src/x.ts', dataConf: 'internal' }).ok).toBe(true);
    expect(covers(leaf, { tool: 'fs.write', op: 'delete', resource: 'fs:src/x.ts', dataConf: 'internal' }).ok).toBe(false);
    expect(covers(leaf, { tool: 'fs.write', op: 'write', resource: 'fs:lib/x.ts', dataConf: 'internal' }).ok).toBe(false);
    expect(covers(leaf, { tool: 'fs.write', op: 'write', resource: 'fs:src/x.ts', dataConf: 'restricted' }).ok).toBe(false);
  });
});

describe('scheme-wide resource patterns', () => {
  it('matches everything under the scheme and nothing else', () => {
    expect(matchesResource('fs:**', 'fs:notes/a.md')).toBe(true);
    expect(matchesResource('fs:**', 'fs:a.md')).toBe(true);
    expect(matchesResource('fs:**', 'mail:a@b.test')).toBe(false);
    expect(matchesResource('shadow:**', 'shadow:notes/deep/x.md')).toBe(true);
  });

  it('still honours a directory prefix, and treats it as narrower', () => {
    expect(matchesResource('fs:notes/**', 'fs:notes/a.md')).toBe(true);
    expect(matchesResource('fs:notes/**', 'fs:other/a.md')).toBe(false);
    expect(patternSubset('fs:notes/**', 'fs:**')).toBe(true);
    expect(patternSubset('fs:**', 'fs:notes/**')).toBe(false);
  });

  it('refuses an unsafe target through a scheme-wide pattern', () => {
    expect(matchesResource('fs:**', 'fs:../etc/passwd')).toBe(false);
  });
});
