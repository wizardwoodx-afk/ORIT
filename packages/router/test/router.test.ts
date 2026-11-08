import { describe, expect, it } from 'vitest';
import { BOTTOM_LABEL, type Label } from '@si/core';
import { Ledger } from '@si/ledger';
import { MemoryVault, ModelGateway, type ModelRef, NoRouteError, OpenAICompatProvider, ScriptedProvider } from '../src/index.ts';

const models: ModelRef[] = [
  { id: 'local-small', provider: 'local', model: 'qwen', locality: 'local', maxConf: 'restricted', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'cloud-big', provider: 'cloud', model: 'big', locality: 'cloud', maxConf: 'internal', baseUrl: 'https://api.example.test/v1' },
];
const roles = { planner: ['cloud-big', 'local-small'], worker: ['local-small'], judge: ['cloud-big'], reader: ['local-small'], summarizer: ['local-small'], embedder: ['local-small'] } as const;
const label = (conf: Label['conf']): Label => ({ ...BOTTOM_LABEL, conf });

const make = (opts: { airGap?: boolean } = {}) => {
  const ledger = new Ledger();
  const cloud = new ScriptedProvider([{ text: 'cloud', usage: { input: 1, output: 1 } }]);
  const local = new ScriptedProvider([{ text: 'local', usage: { input: 1, output: 1 } }, { text: 'local2', usage: { input: 1, output: 1 } }]);
  const gw = new ModelGateway({
    models, policy: { airGap: opts.airGap ?? false, maxCloudConf: 'internal', roles: roles as never },
    providers: { cloud, local }, vault: new MemoryVault({ 'cloud-big': 'sk-test-123' }), ledger,
  });
  return { gw, ledger, cloud, local };
};
const msg = (content: string) => [{ role: 'user' as const, content }];

describe('model gateway routing', () => {
  it('uses the cloud model for non-sensitive data and shows a Cloud chip', async () => {
    const { gw } = make();
    const r = await gw.complete({ role: 'planner', messages: msg('plan a release'), label: label('internal') });
    expect(r).toMatchObject({ modelId: 'cloud-big', chip: 'Cloud: cloud', locality: 'cloud' });
  });

  it('keeps confidential data local even when the cloud model is preferred', async () => {
    const { gw, cloud } = make();
    const r = await gw.complete({ role: 'planner', messages: msg('quarterly numbers'), label: label('confidential') });
    expect(r).toMatchObject({ modelId: 'local-small', chip: 'Local' });
    expect(cloud.calls).toHaveLength(0);
  });

  it('refuses a cloud-only role when the data is too sensitive, with reasons, and logs the refusal', async () => {
    const { gw, ledger } = make();
    await expect(gw.complete({ role: 'judge', messages: msg('x'), label: label('restricted') })).rejects.toBeInstanceOf(NoRouteError);
    expect(ledger.events().some((e) => e.kind === 'model.refused')).toBe(true);
  });

  it('blocks the cloud when the prompt itself contains a secret, even if the label says public', async () => {
    const { gw, cloud } = make();
    const r = await gw.complete({ role: 'planner', messages: msg('use key AKIAABCDEFGHIJKLMNOP to deploy'), label: label('public') });
    expect(r.locality).toBe('local');
    expect(cloud.calls).toHaveLength(0);
  });

  it('air-gap makes cloud routes impossible', async () => {
    const { gw } = make({ airGap: true });
    expect((await gw.complete({ role: 'planner', messages: msg('hi'), label: label('public') })).locality).toBe('local');
    await expect(gw.complete({ role: 'judge', messages: msg('hi'), label: label('public') })).rejects.toThrow(/air-gap/);
  });

  it('never stores prompt text or keys in the ledger', async () => {
    const { gw, ledger } = make();
    await gw.complete({ role: 'planner', messages: msg('SECRET-PROMPT-TEXT'), label: label('public') });
    const dump = JSON.stringify(ledger.events());
    expect(dump).not.toContain('SECRET-PROMPT-TEXT');
    expect(dump).not.toContain('sk-test-123');
  });

  it('refuses a router policy that would allow restricted data in the cloud', () => {
    expect(() => new ModelGateway({ models, policy: { airGap: false, maxCloudConf: 'restricted', roles: roles as never }, providers: {}, vault: new MemoryVault(), ledger: new Ledger() })).toThrow();
  });
});

describe('OpenAI-compatible provider', () => {
  it('sends the key only to cloud models and parses tool calls and usage', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fake: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok', tool_calls: [{ function: { name: 'fs.read', arguments: '{"path":"a"}' } }, { function: { name: 'bad', arguments: '{oops' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 });
    };
    const ledger = new Ledger();
    const p = new OpenAICompatProvider(fake);
    const gw = new ModelGateway({ models, policy: { airGap: false, maxCloudConf: 'internal', roles: roles as never }, providers: { cloud: p, local: p }, vault: new MemoryVault({ 'cloud-big': 'sk-test-123' }), ledger });
    const cloud = await gw.complete({ role: 'judge', messages: msg('hi'), label: label('public') });
    expect(cloud.toolCalls).toEqual([{ tool: 'fs.read', args: { path: 'a' } }]);
    expect(cloud.usage).toEqual({ input: 3, output: 4 });
    await gw.complete({ role: 'worker', messages: msg('hi'), label: label('public') });
    expect(seen[0]).toEqual({ url: 'https://api.example.test/v1/chat/completions', auth: 'Bearer sk-test-123' });
    expect(seen[1]?.auth).toBeNull();
  });

  it('falls back only within the allowed set', async () => {
    const down: typeof fetch = async () => new Response('x', { status: 500 });
    const ledger = new Ledger();
    const local = new ScriptedProvider([{ text: 'local-ok', usage: { input: 1, output: 1 } }]);
    const gw = new ModelGateway({ models, policy: { airGap: false, maxCloudConf: 'internal', roles: roles as never }, providers: { cloud: new OpenAICompatProvider(down), local }, vault: new MemoryVault({ 'cloud-big': 'k' }), ledger });
    const r = await gw.complete({ role: 'planner', messages: msg('hi'), label: label('public') });
    expect(r.modelId).toBe('local-small');
    expect(ledger.events().find((e) => e.kind === 'model.call')?.body.fellBackFrom).toEqual(['cloud-big: provider http 500']);
  });
});
