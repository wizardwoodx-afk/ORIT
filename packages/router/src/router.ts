import { type Conf, type Label, joinLabels, confRank, sha256hex } from '@si/core';
import { scanText } from '@si/classifier';
import type { Ledger } from '@si/ledger';

export type Role = 'planner' | 'worker' | 'judge' | 'reader' | 'summarizer' | 'embedder';

export interface ModelRef {
  id: string;
  provider: string; // key into the provider table
  model: string;
  locality: 'local' | 'cloud';
  /** Highest data confidentiality this model may ever receive. Local models normally accept "restricted". */
  maxConf: Conf;
  baseUrl?: string;
}

export interface RouterPolicy {
  /** Hard switch: when true, cloud routes are impossible. */
  airGap: boolean;
  /** Ceiling for any cloud call. "restricted" is never allowed. */
  maxCloudConf: Conf;
  roles: Record<Role, string[]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}
export interface ToolCallProposal {
  tool: string;
  args: Record<string, unknown>;
}
export interface ProviderOutput {
  text: string;
  toolCalls?: ToolCallProposal[];
  usage: { input: number; output: number };
}
export interface ModelProvider {
  complete(model: ModelRef, messages: ChatMessage[], opts: { apiKey?: string; maxTokens?: number }): Promise<ProviderOutput>;
}

/** Keys live behind the gateway. The brain only ever sees results, never credentials. */
export interface KeyVault {
  get(modelId: string): string | undefined;
}
export class MemoryVault implements KeyVault {
  constructor(private readonly keys: Record<string, string> = {}) {}
  get(id: string) {
    return this.keys[id];
  }
}

export interface CompleteRequest {
  role: Role;
  messages: ChatMessage[];
  /** Join of everything in the prompt. Supplied by the gateway session, not by the model. */
  label: Label;
  maxTokens?: number;
}
export interface CompleteResult extends ProviderOutput {
  modelId: string;
  /** What the user sees on every message so they always know where data went. */
  chip: string;
  locality: 'local' | 'cloud';
  label: Label;
}

export class NoRouteError extends Error {
  constructor(readonly reasons: string[]) {
    super(`no allowed model route: ${reasons.join('; ')}`);
  }
}

export interface ModelGatewayDeps {
  models: ModelRef[];
  policy: RouterPolicy;
  providers: Record<string, ModelProvider>;
  vault: KeyVault;
  ledger: Ledger;
  /** Optional token meter (gateway budget). Returns false when the order is out of tokens. */
  reserveTokens?: (n: number) => boolean;
}

export class ModelGateway {
  constructor(private readonly d: ModelGatewayDeps) {
    if (d.policy.maxCloudConf === 'restricted') throw new Error('router policy: restricted data may never go to the cloud');
  }

  /** Pure routing decision, exposed for tests and for the UI's "where will this go?" preview. */
  candidates(req: CompleteRequest): { allowed: ModelRef[]; refused: Array<{ id: string; reason: string }> } {
    const text = req.messages.map((m) => m.content).join('\n');
    const scan = scanText(text);
    const allowed: ModelRef[] = [];
    const refused: Array<{ id: string; reason: string }> = [];
    for (const id of this.d.policy.roles[req.role] ?? []) {
      const m = this.d.models.find((x) => x.id === id);
      if (!m) continue;
      if (m.locality === 'cloud') {
        if (this.d.policy.airGap) { refused.push({ id, reason: 'air-gap is on' }); continue; }
        if (confRank(req.label.conf) > confRank(this.d.policy.maxCloudConf)) { refused.push({ id, reason: 'data label too sensitive for cloud' }); continue; }
        if (confRank(req.label.conf) > confRank(m.maxConf)) { refused.push({ id, reason: 'data label above this model limit' }); continue; }
        if (scan.conf === 'restricted') { refused.push({ id, reason: 'prompt contains secrets or regulated identifiers' }); continue; }
      } else if (confRank(req.label.conf) > confRank(m.maxConf)) {
        refused.push({ id, reason: 'data label above this model limit' });
        continue;
      }
      allowed.push(m);
    }
    return { allowed, refused };
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const { allowed, refused } = this.candidates(req);
    if (allowed.length === 0) {
      this.d.ledger.append('model.refused', 'router', { role: req.role, refused, labelConf: req.label.conf });
      throw new NoRouteError(refused.map((r) => `${r.id}: ${r.reason}`));
    }
    const estimate = Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4) + (req.maxTokens ?? 512);
    if (this.d.reserveTokens && !this.d.reserveTokens(estimate)) throw new NoRouteError(['token budget exhausted']);
    const failures: string[] = [];
    for (const model of allowed) {
      const provider = this.d.providers[model.provider];
      if (!provider) { failures.push(`${model.id}: no provider`); continue; }
      try {
        const apiKey = model.locality === 'cloud' ? this.d.vault.get(model.id) : undefined;
        if (model.locality === 'cloud' && !apiKey) { failures.push(`${model.id}: no key in vault`); continue; }
        const out = await provider.complete(model, req.messages, { ...(apiKey ? { apiKey } : {}), ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}) });
        const chip = model.locality === 'local' ? 'Local' : `Cloud: ${model.provider}`;
        this.d.ledger.append('model.call', 'router', {
          role: req.role, modelId: model.id, chip, labelConf: req.label.conf,
          promptHash: sha256hex(req.messages.map((m) => m.content).join('\n')),
          tokensIn: out.usage.input, tokensOut: out.usage.output, fellBackFrom: failures,
        });
        return { ...out, modelId: model.id, chip, locality: model.locality, label: joinLabels(req.label, { conf: 'public', integrity: 'tool', provenance: [`model:${model.id}`] }) };
      } catch (e) {
        failures.push(`${model.id}: ${(e as Error).message}`);
      }
    }
    this.d.ledger.append('model.failed', 'router', { role: req.role, failures });
    throw new NoRouteError(failures);
  }
}

/** OpenAI-compatible chat completions. Ollama and llama.cpp servers expose this shape; verify the exact base URL per install. */
export class OpenAICompatProvider implements ModelProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async complete(model: ModelRef, messages: ChatMessage[], opts: { apiKey?: string; maxTokens?: number }): Promise<ProviderOutput> {
    if (!model.baseUrl) throw new Error('model has no baseUrl');
    const res = await this.fetchImpl(`${model.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
      body: JSON.stringify({ model: model.model, messages, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) }),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`provider http ${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = j.choices?.[0]?.message;
    const toolCalls: ToolCallProposal[] = [];
    for (const tc of msg?.tool_calls ?? []) {
      try {
        toolCalls.push({ tool: String(tc.function?.name), args: JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown> });
      } catch { /* a malformed tool call is dropped, never guessed */ }
    }
    return { text: msg?.content ?? '', ...(toolCalls.length ? { toolCalls } : {}), usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
  }
}

/** Deterministic provider for tests and offline demos. */
export class ScriptedProvider implements ModelProvider {
  readonly calls: ChatMessage[][] = [];
  constructor(private readonly script: Array<ProviderOutput | ((m: ChatMessage[]) => ProviderOutput)>) {}
  async complete(_m: ModelRef, messages: ChatMessage[]): Promise<ProviderOutput> {
    this.calls.push(messages);
    const next = this.script.shift();
    if (!next) throw new Error('scripted provider exhausted');
    return typeof next === 'function' ? next(messages) : next;
  }
}
