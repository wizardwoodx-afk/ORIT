/**
 * Provider adapters, tested against a fake transport.
 *
 * No network in these tests, on purpose: the adapters are pure request/response translation, and the
 * only honest way to pin them is to assert the exact bytes that would leave the machine and the exact
 * shape that comes back. A loop that sends the wrong tool_result id fails here, not in production.
 */
import { describe, expect, it, vi } from 'vitest';
import { BOTTOM_LABEL } from '@si/core';
import { Ledger } from '@si/ledger';
import {
  AnthropicProvider,
  type ChatMessage,
  MemoryVault,
  ModelGateway,
  type ModelRef,
  OpenAICompatProvider,
  ScriptedProvider,
  type ToolSpec,
} from '../src/index.ts';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tools: ToolSpec[] = [
  {
    name: 'write_file',
    description: 'Write a file in the Space workspace.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
];

const anthropicModel: ModelRef = {
  id: 'claude',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  locality: 'cloud',
  maxConf: 'internal',
};

const localModel: ModelRef = {
  id: 'local-small',
  provider: 'local',
  model: 'qwen',
  locality: 'local',
  maxConf: 'restricted',
  baseUrl: 'http://127.0.0.1:11434/v1',
};

describe('Anthropic provider', () => {
  it('lifts the system prompt out, keeps tool ids, and parses text plus tool_use', async () => {
    const fetchImpl = vi.fn(async () => {
      return jsonResponse({
        content: [
          { type: 'text', text: 'I will write the note.' },
          { type: 'tool_use', id: 'toolu_01', name: 'write_file', input: { path: 'notes/a.md', content: 'hi' } },
        ],
        usage: { input_tokens: 120, output_tokens: 40 },
        stop_reason: 'tool_use',
      });
    });
    const provider = new AnthropicProvider(fetchImpl as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are SelfImpulse.' },
      { role: 'user', content: 'write a note' },
      { role: 'assistant', content: 'reading first', toolCalls: [{ id: 'toolu_00', tool: 'read_file', args: { path: 'notes/a.md' } }] },
      { role: 'tool', content: 'old content', toolCallId: 'toolu_00', toolName: 'read_file' },
    ];
    const out = await provider.complete(anthropicModel, messages, { apiKey: 'sk-ant-test', tools });

    expect(out.text).toBe('I will write the note.');
    expect(out.toolCalls?.[0]).toEqual({ id: 'toolu_01', tool: 'write_file', args: { path: 'notes/a.md', content: 'hi' } });
    expect(out.usage).toEqual({ input: 120, output: 40 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.system).toBe('You are SelfImpulse.');
    expect(body.tools).toEqual([{ name: 'write_file', description: tools[0]?.description, input_schema: tools[0]?.inputSchema }]);
    const wire = body.messages as Array<{ role: string; content: unknown }>;
    expect(wire.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(wire[1]?.content).toEqual([
      { type: 'text', text: 'reading first' },
      { type: 'tool_use', id: 'toolu_00', name: 'read_file', input: { path: 'notes/a.md' } },
    ]);
    expect(wire[2]?.content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_00', content: 'old content' }]);
  });

  it('carries a custom baseUrl for a gateway that speaks the same shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} }));
    const provider = new AnthropicProvider(fetchImpl as unknown as typeof fetch);
    await provider.complete({ ...anthropicModel, baseUrl: 'https://proxy.test/' }, [{ role: 'user', content: 'hi' }], {
      apiKey: 'k',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/messages');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.system).toBeUndefined();
    expect(body.max_tokens).toBe(1024);
  });

  it('fails loudly on a non-2xx instead of inventing an answer', async () => {
    const provider = new AnthropicProvider((async () => jsonResponse({ error: 'nope' }, 429)) as unknown as typeof fetch);
    await expect(provider.complete(anthropicModel, [{ role: 'user', content: 'hi' }], { apiKey: 'k' })).rejects.toThrow(
      'provider http 429',
    );
  });
});

describe('OpenAI-compatible provider', () => {
  it('sends function tools and maps assistant calls and tool results with ids', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: 'done', tool_calls: [{ id: 'call_7', function: { name: 'write_file', arguments: '{"path":"a.md","content":"x"}' } }] } }],
        usage: { prompt_tokens: 30, completion_tokens: 12 },
      }),
    );
    const provider = new OpenAICompatProvider(fetchImpl as unknown as typeof fetch);
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'thinking', toolCalls: [{ id: 'call_6', tool: 'read_file', args: { path: 'a.md' } }] },
      { role: 'tool', content: 'old', toolCallId: 'call_6', toolName: 'read_file' },
    ];
    const out = await provider.complete(localModel, messages, { tools, maxTokens: 256 });

    expect(out.toolCalls?.[0]).toEqual({ id: 'call_7', tool: 'write_file', args: { path: 'a.md', content: 'x' } });
    expect(out.usage).toEqual({ input: 30, output: 12 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number;
      tools: Array<{ type: string; function: { name: string } }>;
      messages: Array<Record<string, unknown>>;
    };
    expect(body.max_tokens).toBe(256);
    expect(body.tools[0]?.function.name).toBe('write_file');
    expect(body.messages[0]).toMatchObject({ role: 'assistant', content: 'thinking' });
    const assistantTurn = body.messages[0];
    if (!assistantTurn) throw new Error('assistant message missing');
    const calls = assistantTurn.tool_calls as Array<{ id: string }>;
    expect(calls[0]?.id).toBe('call_6');
    expect(body.messages[1]).toEqual({ role: 'tool', tool_call_id: 'call_6', content: 'old' });
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('drops a malformed tool call rather than guessing at it', async () => {
    const provider = new OpenAICompatProvider(
      (async () =>
        jsonResponse({
          choices: [{ message: { content: 'x', tool_calls: [{ id: 'c1', function: { name: 'write_file', arguments: '{not json' } }] } }],
        })) as unknown as typeof fetch,
    );
    const out = await provider.complete(localModel, [{ role: 'user', content: 'go' }], {});
    expect(out.toolCalls).toBeUndefined();
    expect(out.text).toBe('x');
  });
});

describe('gateway passes tools to the provider and logs the call', () => {
  it('advertises the same tool set the agent will accept, and meters tokens', async () => {
    const ledger = new Ledger();
    const seen: Array<readonly ToolSpec[] | undefined> = [];
    const provider = {
      complete: async (_m: ModelRef, _msgs: ChatMessage[], opts: { tools?: readonly ToolSpec[] }) => {
        seen.push(opts.tools);
        return { text: 'ok', usage: { input: 5, output: 2 } };
      },
    };
    const gw = new ModelGateway({
      models: [localModel],
      policy: {
        airGap: true,
        maxCloudConf: 'internal',
        roles: { planner: ['local-small'], worker: [], judge: [], reader: [], summarizer: [], embedder: [] } as never,
      },
      providers: { local: provider },
      vault: new MemoryVault(),
      ledger,
    });
    const out = await gw.complete({
      role: 'planner',
      messages: [{ role: 'user', content: 'go' }],
      label: { ...BOTTOM_LABEL, conf: 'public' },
      tools,
    });
    expect(out.text).toBe('ok');
    expect(seen[0]).toEqual(tools);
    const call = ledger.events(1, 1)[0];
    expect(call?.kind).toBe('model.call');
    expect(call?.body).toMatchObject({ tokensIn: 5, tokensOut: 2, chip: 'Local' });
  });

  it('still refuses cloud when the air gap is on, tools or not', async () => {
    const ledger = new Ledger();
    const cloud = new ScriptedProvider([{ text: 'nope', usage: { input: 1, output: 1 } }]);
    const gw = new ModelGateway({
      models: [anthropicModel],
      policy: {
        airGap: true,
        maxCloudConf: 'internal',
        roles: { planner: ['claude'], worker: [], judge: [], reader: [], summarizer: [], embedder: [] } as never,
      },
      providers: { anthropic: cloud },
      vault: new MemoryVault({ claude: 'sk-ant-test' }),
      ledger,
    });
    await expect(
      gw.complete({
        role: 'planner',
        messages: [{ role: 'user', content: 'hi' }],
        label: { ...BOTTOM_LABEL, conf: 'public' },
        tools,
      }),
    ).rejects.toThrow(/air-gap/);
    expect(cloud.calls).toHaveLength(0);
  });
});
