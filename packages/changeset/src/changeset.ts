import { type ToolCall, canonicalize, sha256hex } from '@si/core';
import type { Broker, ExecResult, ScopeEntry } from '@si/gateway';

export interface FileOp {
  path: string;
  kind: 'create' | 'modify' | 'delete';
  beforeHash: string | null;
  afterHash: string | null;
  before: string | null;
  after: string | null;
  /** Local file edits are exactly reversible from the stored before-content. */
  recoveryClass: 'R1';
  state: 'rehearsed';
}
export interface ChangeSet {
  id: string;
  ops: FileOp[];
  /** Binds path, kind and before/after content hashes. Humans sign over this. */
  hash: string;
}

const textHash = (s: string): string => sha256hex(Buffer.from(s, 'utf8'));

export const changeSetHashOf = (ops: readonly FileOp[]): string =>
  sha256hex(canonicalize(ops.map((o) => ({ p: o.path, k: o.kind, b: o.beforeHash, a: o.afterHash }))));

/** Minimal authority for a ChangeSet: exact files only, never a directory wildcard. */
export function scopeForChangeSet(cs: ChangeSet): ScopeEntry[] {
  const out: ScopeEntry[] = [];
  for (const o of cs.ops) {
    const r = `fs:${o.path}`;
    out.push({ tool: 'fs.read', ops: ['read'], resource: r });
    out.push({ tool: 'fs.write', ops: ['write'], resource: r }); // forward write, or rollback of a delete
    if (o.kind !== 'modify') out.push({ tool: 'fs.delete', ops: ['delete'], resource: r }); // forward delete, or rollback of a create
  }
  return out;
}

export function verifyChangeSetIntegrity(cs: ChangeSet): string | null {
  if (changeSetHashOf(cs.ops) !== cs.hash) return 'changeset hash mismatch';
  for (const o of cs.ops) {
    if (o.after !== null && textHash(o.after) !== o.afterHash) return `after-content hash mismatch for ${o.path}`;
    if (o.before !== null && textHash(o.before) !== o.beforeHash) return `before-content hash mismatch for ${o.path}`;
  }
  return null;
}

let seq = 0;
const mkCall = (tool: string, args: Record<string, unknown>, node: string): ToolCall => ({
  id: `cs-${node}-${seq}`,
  tool,
  args,
  nodeId: node,
  step: seq++,
});

const isMissing = (r: ExecResult) => r.kind === 'error' && r.message.includes('ENOENT');

/** Rehearsal overlay: only touched files are copied into the shadow root; every access goes through the gateway. */
export class Rehearsal {
  private readonly touched = new Map<string, { before: string | null; after: string | null }>();
  constructor(
    private readonly broker: Broker,
    private readonly node = 'rehearse',
  ) {}

  private async baseline(path: string): Promise<string | null> {
    const r = await this.broker.call(mkCall('fs.read', { path }, this.node));
    if (r.kind === 'ok') return (r.value as { content: string }).content;
    if (isMissing(r)) return null;
    throw new Error(`rehearsal: cannot read baseline for ${path}: ${describe(r)}`);
  }

  async stageWrite(path: string, content: string): Promise<void> {
    const before = this.touched.has(path) ? (this.touched.get(path) as { before: string | null }).before : await this.baseline(path);
    const w = await this.broker.call(mkCall('shadow.write', { path, content }, this.node));
    if (w.kind !== 'ok') throw new Error(`rehearsal: shadow write refused for ${path}: ${describe(w)}`);
    this.touched.set(path, { before, after: content });
  }

  async stageDelete(path: string): Promise<void> {
    const before = this.touched.has(path) ? (this.touched.get(path) as { before: string | null }).before : await this.baseline(path);
    if (before === null) throw new Error(`rehearsal: ${path} does not exist`);
    this.touched.set(path, { before, after: null });
  }

  /** Reads through the overlay: shadow if touched, otherwise the live file. */
  view(): View {
    return {
      read: async (path) => {
        const t = this.touched.get(path);
        if (t) return t.after;
        return this.baseline(path);
      },
    };
  }

  build(): ChangeSet {
    const ops: FileOp[] = [];
    for (const [path, t] of [...this.touched.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (t.before === t.after) continue;
      ops.push({
        path,
        kind: t.before === null ? 'create' : t.after === null ? 'delete' : 'modify',
        before: t.before,
        after: t.after,
        beforeHash: t.before === null ? null : textHash(t.before),
        afterHash: t.after === null ? null : textHash(t.after),
        recoveryClass: 'R1',
        state: 'rehearsed',
      });
    }
    return { id: `cs-${sha256hex(canonicalize(ops.map((o) => o.path)) + Date.now()).slice(0, 10)}`, ops, hash: changeSetHashOf(ops) };
  }
}

export interface View {
  read(path: string): Promise<string | null>;
}
export interface Check {
  id: string;
  run(view: View): Promise<{ pass: boolean; detail: string }>;
}

export async function runChecks(checks: readonly Check[], view: View): Promise<Array<{ id: string; pass: boolean; detail: string }>> {
  const out = [];
  for (const c of checks) {
    try {
      out.push({ id: c.id, ...(await c.run(view)) });
    } catch (e) {
      out.push({ id: c.id, pass: false, detail: `check threw: ${(e as Error).message}` });
    }
  }
  return out;
}

export type CommitStatus = 'committed' | 'drifted' | 'rolled_back' | 'rejected';
export interface CommitResult {
  status: CommitStatus;
  applied: string[];
  drifted: string[];
  reason?: string;
  receipts: number[];
}

const describe = (r: ExecResult): string =>
  r.kind === 'denied' ? `${r.layer}: ${r.reason}` : r.kind === 'error' ? r.message : r.kind === 'ask' ? 'needs approval' : 'ok';

/**
 * COMMIT replays the rehearsed ChangeSet deterministically.
 * It takes no model provider on purpose: what the human signed is exactly what runs.
 * Each write is conditional on the live file still matching what was rehearsed (compare-and-swap).
 */
/**
 * `authorize` runs for every call that will change something, immediately before it is made. A caller
 * that must satisfy a human-approval dial uses it to register a signature bound to that exact call id
 * and argument hash. It cannot make a call pass; it can only present authority the gateway already
 * verifies against registered human keys.
 */
export async function commitChangeSet(
  broker: Broker,
  cs: ChangeSet,
  node = 'commit',
  authorize?: (call: ToolCall) => void,
): Promise<CommitResult> {
  const bad = verifyChangeSetIntegrity(cs);
  if (bad) return { status: 'rejected', applied: [], drifted: [], reason: bad, receipts: [] };

  // Preflight drift check: nothing is touched unless every file still matches its rehearsed baseline.
  const drifted: string[] = [];
  for (const o of cs.ops) {
    const r = await broker.call(mkCall('fs.read', { path: o.path }, node));
    const live = r.kind === 'ok' ? textHash((r.value as { content: string }).content) : isMissing(r) ? null : 'unreadable';
    if (live !== o.beforeHash) drifted.push(o.path);
  }
  if (drifted.length) return { status: 'drifted', applied: [], drifted, reason: 'live files changed since rehearsal', receipts: [] };

  const applied: FileOp[] = [];
  const receipts: number[] = [];
  for (const o of cs.ops) {
    const call =
      o.kind === 'delete'
        ? mkCall('fs.delete', { path: o.path, expectBeforeHash: o.beforeHash }, node)
        : mkCall('fs.write', { path: o.path, content: o.after, expectBeforeHash: o.beforeHash }, node);
    authorize?.(call);
    const r = await broker.call(call);
    if (r.kind === 'ok') {
      applied.push(o);
      receipts.push(r.receiptSeq);
      continue;
    }
    const rb = await rollback(broker, applied, node, authorize);
    const wasDrift = r.kind === 'error' && r.name === 'PreconditionFailed';
    return {
      status: wasDrift ? 'drifted' : 'rolled_back',
      applied: [],
      drifted: wasDrift ? [o.path] : [],
      reason: `${describe(r)}${rb.length ? `; rollback incomplete for ${rb.join(', ')}` : ''}`,
      receipts,
    };
  }
  return { status: 'committed', applied: applied.map((o) => o.path), drifted: [], receipts };
}

/** R1 rollback from stored before-content, conditional on the file still being what we wrote. Returns paths that failed. */
export async function rollback(
  broker: Broker,
  applied: readonly FileOp[],
  node = 'rollback',
  authorize?: (call: ToolCall) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const o of [...applied].reverse()) {
    const call =
      o.kind === 'create'
        ? mkCall('fs.delete', { path: o.path, expectBeforeHash: o.afterHash }, node)
        : mkCall('fs.write', { path: o.path, content: o.before, expectBeforeHash: o.afterHash }, node);
    authorize?.(call);
    const r = await broker.call(call);
    if (r.kind !== 'ok') failed.push(o.path);
  }
  return failed;
}

export type ProveVerdict = 'verified' | 'partially_verified' | 'not_verified' | 'blocked';
export interface ProveReport {
  verdict: ProveVerdict;
  hashEvidence: Array<{ path: string; expected: string | null; actual: string | null; match: boolean }>;
  checks: Array<{ id: string; pass: boolean; detail: string }>;
}

/** Independent verification on the LIVE state: re-reads files through the gateway and re-runs the signed checks. */
export async function prove(broker: Broker, cs: ChangeSet, checks: readonly Check[]): Promise<ProveReport> {
  const hashEvidence: ProveReport['hashEvidence'] = [];
  let blocked = false;
  for (const o of cs.ops) {
    const r = await broker.call(mkCall('fs.read', { path: o.path }, 'prove'));
    if (r.kind === 'denied' || r.kind === 'ask') blocked = true;
    const actual = r.kind === 'ok' ? textHash((r.value as { content: string }).content) : null;
    hashEvidence.push({ path: o.path, expected: o.afterHash, actual, match: actual === o.afterHash });
  }
  const liveView: View = {
    read: async (path) => {
      const r = await broker.call(mkCall('fs.read', { path }, 'prove'));
      if (r.kind === 'ok') return (r.value as { content: string }).content;
      if (isMissing(r)) return null;
      throw new Error(describe(r));
    },
  };
  const results = await runChecks(checks, liveView);
  const allHashes = hashEvidence.every((h) => h.match);
  const allChecks = results.every((c) => c.pass);
  const verdict: ProveVerdict = blocked ? 'blocked' : allHashes && allChecks ? 'verified' : allHashes || results.some((c) => c.pass) ? 'partially_verified' : 'not_verified';
  return { verdict, hashEvidence, checks: results };
}
