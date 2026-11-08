import { describe, expect, it } from 'vitest';
import { canonicalize, joinLabels, flowAllowed, newKeyPair, signString, verifyString, publicKeyFromB64 } from '../src/index.ts';

describe('canonicalize', () => {
  it('is order independent and drops undefined', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
  it('rejects non-finite numbers and integer-like keys', () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ '1': 1 })).toThrow();
  });
});

describe('labels', () => {
  it('joins to max confidentiality and min integrity', () => {
    const l = joinLabels(
      { conf: 'internal', integrity: 'user', provenance: ['a'] },
      { conf: 'restricted', integrity: 'untrusted', provenance: ['b'] },
    );
    expect(l).toEqual({ conf: 'restricted', integrity: 'untrusted', provenance: ['a', 'b'] });
    expect(flowAllowed(l, 'confidential')).toBe(false);
  });
});

describe('ed25519', () => {
  it('signs and verifies, and rejects tampering', () => {
    const k = newKeyPair();
    const sig = signString(k.privateKey, 'hello');
    expect(verifyString(publicKeyFromB64(k.publicB64), 'hello', sig)).toBe(true);
    expect(verifyString(publicKeyFromB64(k.publicB64), 'hellp', sig)).toBe(false);
  });
});
