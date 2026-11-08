import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotSchema, ThreadEventSchema } from '../../desktop/src/app/api.ts';
import { Harness } from '../src/app.ts';

/**
 * The wire contract: everything the server emits must parse against the renderer's schema, or the
 * UI goes blank at exactly the moment a human is looking at it.
 */
let harness: Harness;
let dataRoot: string;

const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, ms = 8000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
};

beforeAll(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'si-wire-'));
  harness = await Harness.boot({ dataRoot });
});

afterAll(async () => {
  harness.close();
  await rm(dataRoot, { recursive: true, force: true });
});

describe('wire contract', () => {
  it('emits only events the renderer can parse', async () => {
    harness.runner('co-think').start('Wire the contract check');
    const waiting = await waitFor(
      async () => harness.thread('co-think').list(),
      (events) => events.some((e) => e.type === 'approval'),
      'an approval event',
    );
    const approval = waiting.find((e) => e.type === 'approval');
    if (!approval || approval.type !== 'approval') throw new Error('no approval');
    harness.runner('co-think').approvals.decide(approval.approval.id, 'approve');

    const finished = await waitFor(
      async () => harness.thread('co-think').list(),
      (events) => events.some((e) => e.type === 'state' && e.state === 'completed'),
      'completion',
    );

    for (const event of finished) {
      const parsed = ThreadEventSchema.safeParse(event);
      expect(parsed.success, `event ${event.seq} (${event.type}) does not match the wire schema`).toBe(true);
    }
    expect(new Set(finished.map((e) => e.type))).toEqual(
      new Set(['message', 'state', 'plan', 'approval', 'receipt', 'check', 'notice']),
    );
  });

  it('serves a snapshot the renderer can parse', async () => {
    const snapshot = await harness.snapshot('co-think');
    const parsed = SnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.data.workspace.files).toContain('notes/wire-the-contract-check.md');
    expect(parsed.data.ledger.chainOk).toBe(true);
  });

  it('returns an empty but valid snapshot for a Space that has done nothing', async () => {
    const snapshot = await harness.snapshot('co-work');
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.thread).toEqual([]);
  });
});
