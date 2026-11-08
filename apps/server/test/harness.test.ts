import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditVoice } from '@si/voice';
import { Harness } from '../src/app.ts';
import { createChannel } from '../src/http.ts';
import type { SpaceSnapshot } from '../src/app.ts';

let harness: Harness;
let server: ReturnType<typeof createChannel>;
let base: string;
let dataRoot: string;

const SNAPSHOT = (space: string) => `${base}/api/state?space=${space}`;

const snapshot = async (space: string): Promise<SpaceSnapshot> => {
  const res = await fetch(SNAPSHOT(space));
  expect(res.status).toBe(200);
  return (await res.json()) as SpaceSnapshot;
};

const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, ms = 8000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const statesIn = (snap: SpaceSnapshot): string[] =>
  snap.thread.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state);

beforeAll(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'si-harness-'));
  harness = await Harness.boot({ dataRoot });
  server = createChannel({ harness, roots: [], indexFallback: '/app/index.html' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  harness.close();
  await rm(dataRoot, { recursive: true, force: true });
});

describe('channel', () => {
  it('reports health and refuses an unknown space', async () => {
    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toMatchObject({ ok: true, product: 'SelfImpulse' });
    const bad = await fetch(`${base}/api/state?space=co-evil`);
    expect(bad.status).toBe(400);
  });

  it('rejects a malformed message at the boundary', async () => {
    const res = await fetch(`${base}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: 'co-think' }),
    });
    expect(res.status).toBe(400);
  });

  it('streams thread events as they are produced', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/stream?space=co-work&cursor=0`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    const first = await reader?.read();
    controller.abort();
    expect(new TextDecoder().decode(first?.value).length).toBeGreaterThan(0);
  });
});

describe('a turn', () => {
  it('frames, rehearses, waits for a signature, commits, and proves', async () => {
    const started = await fetch(`${base}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: 'co-think', text: 'Draft the launch note' }),
    });
    expect(started.status).toBe(202);
    const { turnId } = (await started.json()) as { turnId: string };
    expect(turnId.length).toBeGreaterThan(0);

    const waiting = await waitFor(() => snapshot('co-think'), (s) => s.pending.length === 1, 'an approval request');
    expect(statesIn(waiting)).toContain('needs-approval');
    expect(statesIn(waiting)).toContain('rehearsing');
    const approval = waiting.pending[0];
    expect(approval?.recoveryClass).toBe('R1');
    expect(approval?.changeSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approval?.paths).toEqual(['notes/draft-the-launch-note.md']);

    const decided = await fetch(`${base}/api/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: 'co-think', id: approval?.id, decision: 'approve' }),
    });
    expect(decided.status).toBe(200);

    const done = await waitFor(() => snapshot('co-think'), (s) => statesIn(s).includes('completed'), 'completion');
    const states = statesIn(done);
    expect(states.indexOf('framed')).toBeLessThan(states.indexOf('rehearsing'));
    expect(states.indexOf('needs-approval')).toBeLessThan(states.indexOf('running'));
    expect(states.indexOf('verifying')).toBeLessThan(states.indexOf('completed'));

    const target = join(dataRoot, 'co-think', 'workspace', 'notes', 'draft-the-launch-note.md');
    expect(existsSync(target)).toBe(true);
    const written = readFileSync(target, 'utf8');
    expect(written).toContain('Draft the launch note');
    expect(written).toContain('//impulse');

    expect(done.ledger.chainOk).toBe(true);
    expect(done.ledger.seq).toBeGreaterThan(3);
    expect(done.thread.some((e) => e.type === 'receipt')).toBe(true);
    expect(done.thread.some((e) => e.type === 'check' && (e as { pass: boolean }).pass)).toBe(true);
  });

  it('writes nothing when the signature is refused', async () => {
    const before = (await snapshot('co-think')).workspace.files.length;
    await fetch(`${base}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: 'co-think', text: 'Throwaway idea' }),
    });
    const waiting = await waitFor(() => snapshot('co-think'), (s) => s.pending.length === 1, 'a second approval');
    const id = waiting.pending[0]?.id;
    await fetch(`${base}/api/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: 'co-think', id, decision: 'deny' }),
    });
    const cancelled = await waitFor(() => snapshot('co-think'), (s) => statesIn(s).includes('cancelled'), 'cancellation');
    expect(cancelled.thread.some((e) => e.type === 'notice' && (e as { text: string }).text.includes('Cancelled'))).toBe(true);
    expect(existsSync(join(dataRoot, 'co-think', 'workspace', 'notes', 'throwaway-idea.md'))).toBe(false);
    expect((await snapshot('co-think')).workspace.files.length).toBe(before);
  });

  it('keeps the two Spaces apart', async () => {
    const work = await snapshot('co-work');
    expect(work.thread).toEqual([]);
    expect(work.head).toBe(0);
    expect(work.policyCeiling).toBe('internal');
    expect((await snapshot('co-think')).policyCeiling).toBe('confidential');
  });

  it('never leaks hype into a status line', async () => {
    const snap = await snapshot('co-think');
    for (const event of snap.thread) {
      if (event.type === 'notice' || event.type === 'message') {
        expect(auditVoice((event as { text: string }).text), `voice drift: ${(event as { text: string }).text}`).toEqual([]);
      }
    }
  });
});
