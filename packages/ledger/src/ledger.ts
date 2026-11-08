import { DatabaseSync } from 'node:sqlite';
import {
  type KeyPair,
  canonicalize,
  publicKeyFromB64,
  sha256hex,
  signString,
  verifyString,
} from '@si/core';
import { merkleRoot } from './merkle.ts';

export const GENESIS = '0'.repeat(64);

export interface LedgerEvent {
  seq: number;
  ts: number;
  kind: string;
  actor: string;
  /** Redacted metadata only. Raw payloads live in an encrypted sidecar and appear here as hashes. */
  body: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface SignedTreeHead {
  fromSeq: number;
  toSeq: number;
  root: string;
  prevHeadHash: string;
  time: number;
  witnessKeyId: string;
  signature: string;
}

export type IntentState = 'intent' | 'outcome' | 'unknown';

const eventHash = (e: Omit<LedgerEvent, 'hash'>) =>
  sha256hex(canonicalize({ seq: e.seq, ts: e.ts, kind: e.kind, actor: e.actor, body: e.body, prevHash: e.prevHash }));

/** The witness signs tree heads. In production it is a separate process with its own key. */
export interface Witness {
  readonly keyId: string;
  readonly publicB64: string;
  signHead(head: Omit<SignedTreeHead, 'signature' | 'witnessKeyId'>): SignedTreeHead;
}

export function localWitness(key: KeyPair): Witness {
  return {
    keyId: key.id,
    publicB64: key.publicB64,
    signHead(head) {
      const full = { ...head, witnessKeyId: key.id };
      return { ...full, signature: signString(key.privateKey, canonicalize(full)) };
    },
  };
}

export class Ledger {
  readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(path = ':memory:', now: () => number = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
        body TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS heads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_seq INTEGER NOT NULL, to_seq INTEGER NOT NULL,
        root TEXT NOT NULL, prev_head_hash TEXT NOT NULL, time INTEGER NOT NULL,
        witness_key_id TEXT NOT NULL, signature TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS intents (
        key TEXT PRIMARY KEY, call_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
        state TEXT NOT NULL, ts INTEGER NOT NULL, outcome_hash TEXT
      );
    `);
  }

  private lastEvent(): { seq: number; hash: string } {
    const row = this.db.prepare('SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1').get() as
      | { seq: number; hash: string }
      | undefined;
    return row ?? { seq: 0, hash: GENESIS };
  }

  append(kind: string, actor: string, body: Record<string, unknown>): LedgerEvent {
    const last = this.lastEvent();
    const partial = { seq: last.seq + 1, ts: this.now(), kind, actor, body, prevHash: last.hash };
    const event: LedgerEvent = { ...partial, hash: eventHash(partial) };
    this.db
      .prepare('INSERT INTO events (seq, ts, kind, actor, body, prev_hash, hash) VALUES (?,?,?,?,?,?,?)')
      .run(event.seq, event.ts, event.kind, event.actor, canonicalize(event.body), event.prevHash, event.hash);
    return event;
  }

  events(fromSeq = 1, toSeq = Number.MAX_SAFE_INTEGER): LedgerEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq')
      .all(fromSeq, toSeq) as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      seq: Number(r.seq),
      ts: Number(r.ts),
      kind: String(r.kind),
      actor: String(r.actor),
      body: JSON.parse(String(r.body)) as Record<string, unknown>,
      prevHash: String(r.prev_hash),
      hash: String(r.hash),
    }));
  }

  /** Recomputes the chain. Catches in-place edits and deletions, but not a full rewrite. See verifyHeads. */
  verifyChain(): { ok: true } | { ok: false; brokenAt: number; reason: string } {
    let prev = GENESIS;
    let expectedSeq = 1;
    for (const e of this.events()) {
      if (e.seq !== expectedSeq) return { ok: false, brokenAt: e.seq, reason: 'sequence gap' };
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'prevHash mismatch' };
      const { hash, ...rest } = e;
      if (eventHash(rest) !== hash) return { ok: false, brokenAt: e.seq, reason: 'hash mismatch' };
      prev = hash;
      expectedSeq++;
    }
    return { ok: true };
  }

  private lastHead(): SignedTreeHead | undefined {
    const r = this.db.prepare('SELECT * FROM heads ORDER BY id DESC LIMIT 1').get() as
      | Record<string, string | number>
      | undefined;
    return r ? rowToHead(r) : undefined;
  }

  /** Seal all events since the previous head into a Merkle root signed by the witness. */
  seal(witness: Witness): SignedTreeHead | undefined {
    const prevHead = this.lastHead();
    const from = prevHead ? prevHead.toSeq + 1 : 1;
    const evs = this.events(from);
    if (evs.length === 0) return undefined;
    const head = witness.signHead({
      fromSeq: from,
      toSeq: (evs[evs.length - 1] as LedgerEvent).seq,
      root: merkleRoot(evs.map((e) => e.hash)),
      prevHeadHash: prevHead ? sha256hex(canonicalize(prevHead)) : GENESIS,
      time: this.now(),
    });
    this.db
      .prepare(
        'INSERT INTO heads (from_seq,to_seq,root,prev_head_hash,time,witness_key_id,signature) VALUES (?,?,?,?,?,?,?)',
      )
      .run(head.fromSeq, head.toSeq, head.root, head.prevHeadHash, head.time, head.witnessKeyId, head.signature);
    return head;
  }

  heads(): SignedTreeHead[] {
    return (this.db.prepare('SELECT * FROM heads ORDER BY id').all() as Array<Record<string, string | number>>).map(
      rowToHead,
    );
  }

  /** Checks witness signatures, head linkage, and that current events still hash to each sealed root. */
  verifyHeads(witnessPublicB64: string): { ok: true } | { ok: false; reason: string } {
    const pub = publicKeyFromB64(witnessPublicB64);
    let prevHash = GENESIS;
    for (const h of this.heads()) {
      const { signature, ...unsigned } = h;
      if (!verifyString(pub, canonicalize(unsigned), signature)) return { ok: false, reason: `bad signature at head ${h.toSeq}` };
      if (h.prevHeadHash !== prevHash) return { ok: false, reason: `head link broken at ${h.toSeq}` };
      const root = merkleRoot(this.events(h.fromSeq, h.toSeq).map((e) => e.hash));
      if (root !== h.root) return { ok: false, reason: `events changed after seal ${h.fromSeq}-${h.toSeq}` };
      prevHash = sha256hex(canonicalize(h));
    }
    return { ok: true };
  }

  // ---- write-ahead intent journal ----
  writeIntent(key: string, callId: string, ticketId: string): void {
    this.db
      .prepare('INSERT INTO intents (key, call_id, ticket_id, state, ts) VALUES (?,?,?,?,?)')
      .run(key, callId, ticketId, 'intent', this.now());
  }

  writeOutcome(key: string, outcomeHash: string): void {
    this.db.prepare("UPDATE intents SET state='outcome', outcome_hash=? WHERE key=?").run(outcomeHash, key);
  }

  /** After a crash: any intent without an outcome becomes UNKNOWN and needs reconciliation. */
  recoverUnknownIntents(): Array<{ key: string; callId: string }> {
    const rows = this.db.prepare("SELECT key, call_id FROM intents WHERE state='intent'").all() as Array<{
      key: string;
      call_id: string;
    }>;
    this.db.prepare("UPDATE intents SET state='unknown' WHERE state='intent'").run();
    return rows.map((r) => ({ key: r.key, callId: r.call_id }));
  }

  intentState(key: string): IntentState | undefined {
    const r = this.db.prepare('SELECT state FROM intents WHERE key=?').get(key) as { state: IntentState } | undefined;
    return r?.state;
  }

  close(): void {
    this.db.close();
  }
}

function rowToHead(r: Record<string, string | number>): SignedTreeHead {
  return {
    fromSeq: Number(r.from_seq),
    toSeq: Number(r.to_seq),
    root: String(r.root),
    prevHeadHash: String(r.prev_head_hash),
    time: Number(r.time),
    witnessKeyId: String(r.witness_key_id),
    signature: String(r.signature),
  };
}
