/**
 * The model-driven turn, end to end, with a scripted provider.
 *
 * No network and no key: the provider is a script, so what is under test is the machinery that decides
 * what the model may do — the rehearsal scope, the gateway's denials, the human signature, and the
 * receipts. A real provider changes who writes the words, not who holds the authority.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ChatMessage, ProviderOutput, ToolSpec } from '@si/router';
import { ScriptedProvider } from '@si/router';
import { Harness, type SpaceSnapshot } from '../src/app.ts';
import type { Brain } from '../src/model.ts';

let harness: Harness | null = null;
let dataRoot: string | null = null;

const scriptedBrain = (
  script: ProviderOutput[],
): { brain: Brain; provider: ScriptedProvider; seen: ChatMessage[][]; tools: Array<readonly ToolSpec[]> } => {
  const provider = new ScriptedProvider(script);
  const seen: ChatMessage[][] = [];
  const tools: Array<readonly ToolSpec[]> = [];
  const brain: Brain = {
    chip: 'Local',
    modelId: 'test:scripted',
    route: {
      kind: 'openai',
      model: { id: 'test:scripted', provider: 'openai', model: 'scripted', locality: 'local', maxConf: 'restricted' },
      airGap: true,
    },
    async complete(messages: ChatMessage[], offered: readonly ToolSpec[]) {
      seen.push(messages);
      tools.push(offered);
      return provider.complete(
        { id: 'test:scripted', provider: 'openai', model: 'scripted', locality: 'local', maxConf: 'restricted' },
        messages,
        { tools: offered },
      );
    },
  };
  return { brain, provider, seen, tools };
};

/** A fresh data root per test: threads are replayed from disk, so sharing one would leak history. */
const boot = async (script: ProviderOutput[]) => {
  harness?.close();
  dataRoot = await mkdtemp(join(tmpdir(), 'si-agent-'));
  const made = scriptedBrain(script);
  harness = await Harness.boot({ dataRoot, brain: () => made.brain });
  return { ...made, dataRoot };
};

const live = (): { harness: Harness; dataRoot: string } => {
  if (!harness || !dataRoot) throw new Error('harness not booted');
  return { harness, dataRoot };
};

const waitFor = async (read: () => Promise<SpaceSnapshot>, test: (snap: SpaceSnapshot) => boolean, label: string) => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const snap = await read();
    if (test(snap)) return snap;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
};

const statesIn = (snap: SpaceSnapshot): string[] =>
  snap.thread.filter((event) => event.type === 'state').map((event) => (event as { state: string }).state);

afterAll(async () => {
  harness?.close();
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
});

describe('model-driven turn', { timeout: 20_000 }, () => {
  it('rehearses what the model writes, waits for a signature, then lands it with receipts', async () => {
    const { brain, seen, tools } = await boot([
      {
        text: 'Reading first.',
        toolCalls: [{ id: 'call_1', tool: 'write_file', args: { path: 'notes/launch.md', content: '# Launch\n\nShip it.\n' } }],
        usage: { input: 200, output: 40 },
      },
      { text: 'Wrote notes/launch.md with the launch note.', usage: { input: 260, output: 25 } },
    ]);
    expect(brain.modelId).toBe('test:scripted');

    const runner = live().harness.runner('co-think');
    runner.start('write a launch note');

    const waiting = await waitFor(
      () => live().harness.snapshot('co-think'),
      (snap) => statesIn(snap).includes('needs-approval'),
      'approval request',
    );
    const approval = waiting.pending[0];
    if (!approval) throw new Error('no pending approval');
    expect(approval.paths).toEqual(['notes/launch.md']);

    // The plan shown to the human is the write the model actually staged.
    const plan = waiting.thread.find((event) => event.type === 'plan');
    expect(plan).toMatchObject({ type: 'plan', changeSetHash: approval.changeSetHash });
    if (plan?.type !== 'plan') throw new Error('no plan event');
    expect(plan.steps[0]).toMatchObject({ tool: 'shadow.write', resource: 'shadow:notes/launch.md' });

    runner.approvals.decide(approval.id, 'approve');

    const done = await waitFor(
      () => live().harness.snapshot('co-think'),
      (snap) => statesIn(snap).includes('completed'),
      'completion',
    );
    expect(statesIn(done)).toEqual(['framed', 'rehearsing', 'needs-approval', 'running', 'verifying', 'completed']);

    // The world changed exactly as rehearsed, and the ledger says so.
    const written = readFileSync(join(live().harness.spaces['co-think'].liveRoot, 'notes/launch.md'), 'utf8');
    expect(written).toBe('# Launch\n\nShip it.\n');
    expect(done.ledger.chainOk).toBe(true);
    expect(done.thread.some((event) => event.type === 'receipt')).toBe(true);
    expect(done.thread.some((event) => event.type === 'check' && (event as { pass: boolean }).pass)).toBe(true);

    // The model was told the contract and offered exactly the tools the loop accepts.
    const first = seen[0] ?? [];
    expect(first[0]?.role).toBe('system');
    expect(first[0]?.content).toContain('You cannot execute an effect');
    expect(first[1]).toMatchObject({ role: 'user', content: 'write a launch note' });
    expect(tools[0]?.map((tool) => tool.name)).toEqual(['read_file', 'write_file']);
  });

  it('answers in words and asks for no signature when the model proposes no change', async () => {
    await boot([{ text: 'That file already says what you want; nothing to do.', usage: { input: 80, output: 20 } }]);
    live().harness.runner('co-think').start('check the launch note');

    const snap = await waitFor(
      () => live().harness.snapshot('co-think'),
      (s) => statesIn(s).includes('completed'),
      'answer',
    );
    expect(snap.pending).toHaveLength(0);
    const last = snap.thread.filter((event) => event.type === 'state').at(-1);
    expect(last).toMatchObject({ state: 'completed', reason: 'Answered in words. Nothing needed a signature.' });
    const message = snap.thread.filter((event) => event.type === 'message').at(-1);
    expect(message).toMatchObject({ actor: 'assistant', text: 'That file already says what you want; nothing to do.' });
    expect(snap.thread.some((event) => event.type === 'receipt')).toBe(false);
  });

  it('reports a refused path as an observation and stages nothing', async () => {
    const { seen, dataRoot: root } = await boot([
      {
        text: '',
        toolCalls: [{ id: 'call_x', tool: 'write_file', args: { path: '../../etc/passwd', content: 'x' } }],
        usage: { input: 50, output: 10 },
      },
      { text: 'That path is outside the workspace, so I did not write it.', usage: { input: 90, output: 15 } },
    ]);
    live().harness.runner('co-think').start('escape the sandbox');

    const snap = await waitFor(
      () => live().harness.snapshot('co-think'),
      (s) => statesIn(s).includes('completed'),
      'refusal',
    );
    expect(snap.pending).toHaveLength(0);
    expect(existsSync(join(root, 'etc/passwd'))).toBe(false);
    // The model was told, in the loop, that the write did not happen.
    const second = seen[1] ?? [];
    const observation = second.find((message) => message.role === 'tool');
    expect(observation?.content).toMatch(/denied|failed|outside/i);
  });

  it('fails the turn loudly when the provider throws, and signs nothing', async () => {
    const brain: Brain = {
      chip: 'Local',
      modelId: 'test:broken',
      route: {
        kind: 'openai',
        model: { id: 'test:broken', provider: 'openai', model: 'broken', locality: 'local', maxConf: 'restricted' },
        airGap: true,
      },
      async complete() {
        throw new Error('provider http 500');
      },
    };
    harness?.close();
    dataRoot = await mkdtemp(join(tmpdir(), 'si-agent-'));
    harness = await Harness.boot({ dataRoot, brain: () => brain });
    harness.runner('co-think').start('do something');

    const snap = await waitFor(
      () => live().harness.snapshot('co-think'),
      (s) => statesIn(s).includes('blocked'),
      'blocked',
    );
    expect(snap.pending).toHaveLength(0);
    const notice = snap.thread.filter((event) => event.type === 'notice').at(-1);
    expect((notice as { text: string }).text).toContain('No model route answered: provider http 500');
    expect(snap.thread.some((event) => event.type === 'approval')).toBe(false);
  });
});
