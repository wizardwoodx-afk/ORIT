import { describe, expect, it } from 'vitest';
import { newKeyPair } from '@si/core';
import { Ledger, localWitness } from '../src/index.ts';

const mk = () => {
  let t = 1000;
  return new Ledger(':memory:', () => t++);
};

describe('ledger chain', () => {
  it('verifies a clean chain and detects in-place edits', () => {
    const l = mk();
    for (let i = 0; i < 5; i++) l.append('k', 'a', { i });
    expect(l.verifyChain()).toEqual({ ok: true });
    l.db.exec(`UPDATE events SET body='{"i":99}' WHERE seq=3`);
    const v = l.verifyChain();
    expect(v.ok).toBe(false);
  });

  it('detects deleted events', () => {
    const l = mk();
    for (let i = 0; i < 4; i++) l.append('k', 'a', { i });
    l.db.exec('DELETE FROM events WHERE seq=2');
    expect(l.verifyChain().ok).toBe(false);
  });
});

describe('witness heads', () => {
  it('catches a full chain rewrite that a bare hash chain cannot', () => {
    const w = localWitness(newKeyPair());
    const l = mk();
    for (let i = 0; i < 6; i++) l.append('k', 'a', { i });
    l.seal(w);
    expect(l.verifyHeads(w.publicB64)).toEqual({ ok: true });

    // attacker rewrites event 2 AND recomputes every later hash so the chain is internally consistent
    const evs = l.events();
    const forged = mk();
    for (const e of evs) forged.append(e.kind, e.actor, e.seq === 2 ? { i: 'evil' } : e.body);
    expect(forged.verifyChain()).toEqual({ ok: true });
    // but the sealed Merkle root from the witness no longer matches
    for (const h of l.heads()) {
      forged.db
        .prepare('INSERT INTO heads (from_seq,to_seq,root,prev_head_hash,time,witness_key_id,signature) VALUES (?,?,?,?,?,?,?)')
        .run(h.fromSeq, h.toSeq, h.root, h.prevHeadHash, h.time, h.witnessKeyId, h.signature);
    }
    const r = forged.verifyHeads(w.publicB64);
    expect(r.ok).toBe(false);
  });

  it('rejects heads signed by a different key', () => {
    const l = mk();
    l.append('k', 'a', {});
    l.seal(localWitness(newKeyPair()));
    expect(l.verifyHeads(newKeyPair().publicB64).ok).toBe(false);
  });
});

describe('intent journal', () => {
  it('turns unfinished intents into unknown after a crash', () => {
    const l = mk();
    l.writeIntent('k1', 'c1', 't1');
    l.writeIntent('k2', 'c2', 't2');
    l.writeOutcome('k2', 'h');
    expect(l.recoverUnknownIntents()).toEqual([{ key: 'k1', callId: 'c1' }]);
    expect(l.intentState('k1')).toBe('unknown');
    expect(l.intentState('k2')).toBe('outcome');
  });
  it('refuses a duplicate key', () => {
    const l = mk();
    l.writeIntent('k', 'c', 't');
    expect(() => l.writeIntent('k', 'c', 't')).toThrow();
  });
});
