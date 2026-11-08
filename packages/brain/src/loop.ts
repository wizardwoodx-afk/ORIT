/**
 * SelfImpulse — the agent loop.
 *
 * A step is one model call. A turn is as many steps as the budget allows. The loop owns exactly four
 * responsibilities and refuses the rest:
 *
 *   1. Offer the tools it will accept — the advertisement and the acceptance set are the same array.
 *   2. Run each proposed call, feeding the outcome back as an observation.
 *   3. Stop on a real condition: no more calls, no more steps, no more tokens, or an abort.
 *   4. Report what it did, including the stops, so the caller can put a receipt next to it.
 *
 * It does not touch the filesystem, does not decide whether a tool is permitted, and does not narrate
 * success. Effects belong to the gateway; this loop only proposes.
 */
import type { ChatMessage, ProviderOutput, ToolSpec } from '@si/router';
import { type ToolHost, UnknownToolError } from './tools.ts';

export type AgentStop = 'done' | 'steps' | 'budget' | 'aborted' | 'error';

export interface AgentLimits {
  /** Model calls in this turn, not tool calls. Default 6. */
  readonly maxSteps: number;
  /** Prompt plus completion tokens across the turn. Default 24_000. */
  readonly maxTokens: number;
  /** A step proposing more calls than this is truncated, and the truncation is reported. */
  readonly maxToolCallsPerStep: number;
}

export const DEFAULT_LIMITS: AgentLimits = { maxSteps: 6, maxTokens: 24_000, maxToolCallsPerStep: 4 };

export type AgentEvent =
  | { readonly type: 'assistant'; readonly step: number; readonly text: string }
  | { readonly type: 'tool'; readonly step: number; readonly callId: string; readonly name: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly type: 'observation'; readonly step: number; readonly callId: string; readonly name: string; readonly ok: boolean; readonly summary: string }
  | { readonly type: 'stop'; readonly reason: AgentStop; readonly detail?: string };

export interface AgentRequest {
  /** The conversation so far, ending with the user's request. */
  readonly messages: readonly ChatMessage[];
  readonly tools: ToolHost;
  /** One provider call. Supplied by the router, so limits, labels and the ledger stay on that path. */
  readonly complete: (messages: ChatMessage[], tools: readonly ToolSpec[], signal: AbortSignal) => Promise<ProviderOutput>;
  readonly limits?: AgentLimits;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  readonly text: string;
  readonly prompt: string;
  readonly stop: AgentStop;
  readonly steps: number;
  readonly toolCalls: number;
  readonly usage: { readonly input: number; readonly output: number };
  /** The full transcript, so a caller can persist what the model actually saw. */
  readonly messages: ChatMessage[];
  readonly detail?: string;
}

const noop = (): void => {};

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const limits = req.limits ?? DEFAULT_LIMITS;
  const emit = req.onEvent ?? noop;
  const signal = req.signal ?? new AbortController().signal;
  const messages: ChatMessage[] = [...req.messages];
  const usage = { input: 0, output: 0 };

  let text = '';
  let steps = 0;
  let toolCalls = 0;
  let stop: AgentStop = 'done';
  let detail: string | undefined;

  // The prompt as assembled for this turn: the system message the model actually receives.
  const prompt = messages.find((m) => m.role === 'system')?.content ?? '';

  loop: while (steps < limits.maxSteps) {
    if (signal.aborted) {
      stop = 'aborted';
      break;
    }
    if (usage.input + usage.output >= limits.maxTokens) {
      stop = 'budget';
      detail = `token budget spent before step ${steps + 1}`;
      break;
    }

    steps += 1;
    let out: ProviderOutput;
    try {
      out = await req.complete(messages, req.tools.specs, signal);
    } catch (error) {
      if (signal.aborted) {
        stop = 'aborted';
        break;
      }
      stop = 'error';
      detail = error instanceof Error ? error.message : 'provider failed';
      break;
    }

    usage.input += out.usage.input;
    usage.output += out.usage.output;
    if (out.text.length > 0) {
      text = out.text;
      emit({ type: 'assistant', step: steps, text: out.text });
    }

    const proposed = out.toolCalls ?? [];
    if (proposed.length === 0) {
      stop = 'done';
      break;
    }

    const truncated = proposed.length > limits.maxToolCallsPerStep;
    const calls = proposed.slice(0, limits.maxToolCallsPerStep).map((call, index) => ({
      ...call,
      id: call.id ?? `call_${steps}_${index}`,
    }));

    // The assistant turn is recorded with the calls it made, so the provider can answer them.
    messages.push({ role: 'assistant', content: out.text, toolCalls: calls });

    for (const call of calls) {
      if (signal.aborted) {
        stop = 'aborted';
        break loop;
      }
      if (usage.input + usage.output >= limits.maxTokens) {
        stop = 'budget';
        detail = `token budget spent at step ${steps}`;
        break loop;
      }
      toolCalls += 1;
      emit({ type: 'tool', step: steps, callId: call.id ?? '', name: call.tool, args: call.args });

      let summary: string;
      let ok: boolean;
      if (!req.tools.has(call.tool)) {
        // A call the loop will not run is still an observation: the model must be told, not ignored.
        ok = false;
        summary = `unknown tool: ${call.tool}. Offered: ${req.tools.names.join(', ')}.`;
      } else {
        try {
          const outcome = await req.tools.invoke(call.tool, call.args, { signal, step: steps });
          ok = outcome.ok;
          summary = outcome.summary;
        } catch (error) {
          if (!(error instanceof UnknownToolError)) throw error;
          ok = false;
          summary = error.message;
        }
      }
      emit({ type: 'observation', step: steps, callId: call.id ?? '', name: call.tool, ok, summary });
      messages.push({ role: 'tool', content: summary, toolCallId: call.id ?? '', toolName: call.tool });
    }

    if (truncated) {
      detail = `a step proposed ${proposed.length} calls; ${limits.maxToolCallsPerStep} ran`;
    }
    if (steps >= limits.maxSteps) {
      stop = 'steps';
      break;
    }
  }

  emit({ type: 'stop', reason: stop, ...(detail ? { detail } : {}) });
  return {
    text,
    prompt,
    stop,
    steps,
    toolCalls,
    usage,
    messages,
    ...(detail ? { detail } : {}),
  };
}
