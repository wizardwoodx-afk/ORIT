/**
 * The brain loop, tested against a scripted provider.
 *
 * Every assertion here is about a stop condition, an observation, or a transcript. There is no network
 * and no model: what is being pinned is the machine around the model — the part that decides what it is
 * told, what it may call, and when it must stop.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ProviderOutput, ToolSpec } from '@si/router';
import { ScriptedProvider } from '@si/router';
import {
  AGENT_PROMPT,
  buildSystemPrompt,
  DEFAULT_LIMITS,
  type AgentEvent,
  runAgent,
  ToolHost,
  type Tool,
  rehearsalTools,
  UnknownToolError,
} from '../src/index.ts';

const echoTool = (seen: Array<Record<string, unknown>> = []): Tool => ({
  spec: {
    name: 'echo',
    description: 'Echo the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  effectClass: 'read',
  recoveryClass: 'R0',
  async run(args) {
    seen.push(args);
    return { ok: true, summary: `echo:${String(args.text ?? '')}` };
  },
});

const completeWith = (provider: ScriptedProvider) => {
  const seen: ChatMessage[][] = [];
  const toolsSeen: Array<readonly ToolSpec[]> = [];
  return {
    seen,
    toolsSeen,
    complete: (messages: ChatMessage[], tools: readonly ToolSpec[]) => {
      seen.push(messages);
      toolsSeen.push(tools);
      return provider.complete({ id: 'm', provider: 'script', model: 'x', locality: 'local', maxConf: 'restricted' }, messages, {
        tools,
      });
    },
  };
};

const user = (text: string): ChatMessage[] => [{ role: 'user', content: text }];

describe('brain loop', () => {
  it('answers without tools in one step and reports usage', async () => {
    const provider = new ScriptedProvider([{ text: 'all done', usage: { input: 10, output: 4 } }]);
    const { complete } = completeWith(provider);
    const result = await runAgent({ messages: user('say hi'), tools: new ToolHost([]), complete });

    expect(result.stop).toBe('done');
    expect(result.text).toBe('all done');
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.usage).toEqual({ input: 10, output: 4 });
  });

  it('runs a proposed tool, feeds the observation back, and stops on the final answer', async () => {
    const seenArgs: Array<Record<string, unknown>> = [];
    const provider = new ScriptedProvider([
      { text: 'checking', toolCalls: [{ id: 'c1', tool: 'echo', args: { text: 'ping' } }], usage: { input: 5, output: 2 } },
      { text: 'finished', usage: { input: 7, output: 3 } },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      messages: user('echo ping'),
      tools: new ToolHost([echoTool(seenArgs)]),
      complete: completeWith(provider).complete,
      onEvent: (event) => events.push(event),
    });

    expect(seenArgs).toEqual([{ text: 'ping' }]);
    expect(result.stop).toBe('done');
    expect(result.text).toBe('finished');
    expect(result.steps).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(result.usage).toEqual({ input: 12, output: 5 });

    // What the provider saw on the second call: the assistant turn that made the call, then its answer.
    const second = provider.calls[1] ?? [];
    const assistant = second.find((m) => m.role === 'assistant');
    expect(assistant?.toolCalls?.[0]).toMatchObject({ id: 'c1', tool: 'echo' });
    const observation = second.find((m) => m.role === 'tool');
    expect(observation).toMatchObject({ content: 'echo:ping', toolCallId: 'c1', toolName: 'echo' });

    expect(events.map((e) => e.type)).toEqual(['assistant', 'tool', 'observation', 'assistant', 'stop']);
  });

  it('turns an unknown tool into an observation instead of throwing', async () => {
    const provider = new ScriptedProvider([
      { text: '', toolCalls: [{ tool: 'rm_rf', args: {} }], usage: { input: 3, output: 1 } },
      { text: 'that tool does not exist here', usage: { input: 4, output: 2 } },
    ]);
    const result = await runAgent({ messages: user('delete everything'), tools: new ToolHost([echoTool()]), complete: completeWith(provider).complete });

    expect(result.stop).toBe('done');
    expect(result.text).toBe('that tool does not exist here');
    const told = provider.calls[1]?.find((m) => m.role === 'tool');
    expect(told?.content).toContain('unknown tool: rm_rf');
    expect(told?.content).toContain('echo');
    // The loop invented an id for a provider that supplied none.
    expect(told?.toolCallId).toBe('call_1_0');
  });

  it('reports a failing tool as a failed observation and keeps going', async () => {
    const broken: Tool = {
      spec: { name: 'broken', description: 'always fails', inputSchema: { type: 'object', properties: {} } },
      effectClass: 'read',
      recoveryClass: 'R0',
      async run() {
        throw new Error('disk on fire');
      },
    };
    const provider = new ScriptedProvider([
      { text: '', toolCalls: [{ tool: 'broken', args: {} }], usage: { input: 3, output: 1 } },
      { text: 'the tool failed, so I stopped', usage: { input: 4, output: 2 } },
    ]);
    const result = await runAgent({ messages: user('try'), tools: new ToolHost([broken]), complete: completeWith(provider).complete });
    expect(result.stop).toBe('done');
    expect(provider.calls[1]?.find((m) => m.role === 'tool')?.content).toBe('broken failed: disk on fire');
  });

  it('stops at the step limit and says so', async () => {
    const always = (): ProviderOutput => ({ text: '', toolCalls: [{ tool: 'echo', args: { text: 'again' } }], usage: { input: 1, output: 1 } });
    const provider = new ScriptedProvider(Array.from({ length: 10 }, always));
    const result = await runAgent({
      messages: user('loop forever'),
      tools: new ToolHost([echoTool()]),
      complete: completeWith(provider).complete,
      limits: { ...DEFAULT_LIMITS, maxSteps: 3 },
    });
    expect(result.stop).toBe('steps');
    expect(result.steps).toBe(3);
    expect(provider.calls).toHaveLength(3);
  });

  it('stops on the token budget before spending another call', async () => {
    const provider = new ScriptedProvider([{ text: 'expensive', usage: { input: 900, output: 200 } }]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      messages: user('spend'),
      tools: new ToolHost([]),
      complete: completeWith(provider).complete,
      limits: { ...DEFAULT_LIMITS, maxTokens: 1000 },
      onEvent: (e) => events.push(e),
    });
    expect(result.stop).toBe('done');
    expect(provider.calls).toHaveLength(1);
    // The stop event carries the reason a UI can show without inventing one.
    expect(events.at(-1)).toMatchObject({ type: 'stop', reason: 'done' });
  });

  it('honours an abort before the first call and runs nothing', async () => {
    const provider = new ScriptedProvider([{ text: 'should not happen', usage: { input: 1, output: 1 } }]);
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent({
      messages: user('stop'),
      tools: new ToolHost([echoTool()]),
      complete: completeWith(provider).complete,
      signal: controller.signal,
    });
    expect(result.stop).toBe('aborted');
    expect(provider.calls).toHaveLength(0);
    expect(result.steps).toBe(0);
  });

  it('truncates a step that proposes too many calls, and reports the truncation', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ tool: 'echo', args: { text: String(i) } }));
    const provider = new ScriptedProvider([{ text: '', toolCalls: many, usage: { input: 1, output: 1 } }, { text: 'ok', usage: { input: 1, output: 1 } }]);
    const result = await runAgent({
      messages: user('do six things'),
      tools: new ToolHost([echoTool()]),
      complete: completeWith(provider).complete,
      limits: { ...DEFAULT_LIMITS, maxToolCallsPerStep: 2 },
    });
    expect(result.toolCalls).toBe(2);
    expect(result.detail).toContain('proposed 6 calls; 2 ran');
  });

  it('offers exactly the tools it will accept', async () => {
    const provider = new ScriptedProvider([{ text: 'ok', usage: { input: 1, output: 1 } }]);
    const { toolsSeen, complete } = completeWith(provider);
    await runAgent({ messages: user('hello'), tools: new ToolHost([echoTool()]), complete });
    expect(toolsSeen[0]?.map((t: ToolSpec) => t.name)).toEqual(['echo']);
  });

  it('rejects duplicate tool names at construction', async () => {
    expect(() => new ToolHost([echoTool(), echoTool()])).toThrow('duplicate tool: echo');
    await expect(
      new ToolHost([]).invoke('nope', {}, { signal: new AbortController().signal, step: 0 }),
    ).rejects.toThrow(UnknownToolError);
  });
});

describe('brain prompt', () => {
  it('states the contract and the facts of this Space', () => {
    const system = buildSystemPrompt({
      space: 'co-work',
      policyCeiling: 'internal',
      dial: 3,
      tools: [{ name: 'read_file', description: 'r', inputSchema: {} }],
      workspace: ['notes/a.md', 'notes/b.md'],
    });
    expect(system).toContain('Co-think');
    expect(system).toContain('Space: co-work. Policy ceiling: internal. Trust dial: 3.');
    expect(system).toContain('Tools offered: read_file.');
    expect(system).toContain('notes/a.md');
    expect(system).toContain('a human signs the');
  });

  it('says the listing was unavailable instead of claiming an empty workspace', () => {
    const system = buildSystemPrompt({ space: 'co-think', policyCeiling: 'personal', dial: 3, tools: [], workspace: null });
    expect(system).toContain('listing was not available');
    expect(system).not.toContain('The workspace is empty.');
  });

  it('says the workspace is empty rather than leaving it out', () => {
    const system = buildSystemPrompt({ space: 'co-think', policyCeiling: 'personal', dial: 3, tools: [], workspace: [] });
    expect(system).toContain('The workspace is empty.');
  });

  it('does not promise anything the kernel does not enforce', () => {
    expect(AGENT_PROMPT).toContain('You cannot execute an effect');
    expect(AGENT_PROMPT).not.toMatch(/guarantee|trust me|fully secure/i);
  });
});

describe('tools over the governed broker', () => {
  const okResult = (value: unknown) => ({ kind: 'ok' as const, value, label: {} as never, receiptSeq: 1 });

  it('reads through the broker and reports a denial as a denial', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const broker = {
      sessionId: 's1',
      call: async (call: { tool: string; args: Record<string, unknown> }) => {
        calls.push({ tool: call.tool, args: call.args });
        return okResult({ content: 'hello' });
      },
    };
    const rehearsal = { stageWrite: vi.fn() } as never;
    const [read] = rehearsalTools(broker as never, rehearsal);
    if (!read) throw new Error('missing tools');

    const out = await read.run({ path: 'notes/a.md' }, { signal: new AbortController().signal, step: 1 });
    expect(out).toEqual({ ok: true, summary: 'hello' });
    expect(calls[0]).toEqual({ tool: 'fs.read', args: { path: 'notes/a.md' } });

    const denying = { sessionId: 's1', call: async () => ({ kind: 'denied' as const, layer: 'scope', reason: 'outside scope' }) };
    const denied = await rehearsalTools(denying as never, rehearsal)[0]?.run({ path: 'x' }, { signal: new AbortController().signal, step: 1 });
    expect(denied).toEqual({ ok: false, summary: 'denied by scope: outside scope' });
  });

  it('stages writes into the rehearsal, never the live tree', async () => {
    const stageWrite = vi.fn(async () => undefined);
    const broker = { sessionId: 's1', call: async () => okResult(null) };
    const tools = rehearsalTools(broker as never, { stageWrite } as never);
    const write = tools.find((tool) => tool.spec.name === 'write_file');
    if (!write) throw new Error('no write tool');
    const out = await write.run({ path: 'notes/new.md', content: 'body' }, { signal: new AbortController().signal, step: 1 });
    expect(stageWrite).toHaveBeenCalledWith('notes/new.md', 'body');
    expect(out.ok).toBe(true);
    expect(write.effectClass).toBe('sandbox');
    expect(tools.map((t) => t.spec.name)).toEqual(['read_file', 'write_file']);
  });
});
