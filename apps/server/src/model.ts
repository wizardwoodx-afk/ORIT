/**
 * SelfImpulse — the model route.
 *
 * Where a provider is chosen and a key is read. Nothing else in the server touches a credential or a
 * base URL: the brain receives a `complete` function and never learns which provider answered, which is
 * what keeps routing, labels and refusals in one place.
 *
 * Configuration is environment-only, and absent configuration is a valid state — the harness then runs
 * the deterministic template, and says so. A provider that is configured but unreachable fails the turn
 * loudly; it never silently degrades into a template, because that would be a lie about what ran.
 */
import type { ChatMessage, ModelRef, ProviderOutput, ToolSpec } from '@si/router';
import {
  AnthropicProvider,
  MemoryVault,
  ModelGateway,
  type ModelProvider,
  OpenAICompatProvider,
  type Role,
  type RouterPolicy,
} from '@si/router';
import type { Ledger } from '@si/ledger';
import type { Conf } from '@si/core';

export type ProviderKind = 'anthropic' | 'openai';

export interface BrainRoute {
  readonly kind: ProviderKind;
  readonly model: ModelRef;
  readonly airGap: boolean;
}

export interface Brain {
  readonly chip: string;
  readonly modelId: string;
  readonly route: BrainRoute;
  complete(messages: ChatMessage[], tools: readonly ToolSpec[], signal: AbortSignal): Promise<ProviderOutput>;
}

export interface BrainEnv {
  readonly SI_PROVIDER?: string;
  readonly SI_MODEL?: string;
  readonly SI_BASE_URL?: string;
  readonly SI_API_KEY?: string;
  readonly SI_AIRGAP?: string;
  readonly SI_CLOUD_CEILING?: string;
}

export class BrainConfigError extends Error {}

const CONF = ['public', 'internal', 'confidential', 'restricted'] as const;
const asConf = (value: string | undefined, fallback: Conf): Conf =>
  (CONF as readonly string[]).includes(value ?? '') ? (value as Conf) : fallback;

/** A loopback base URL means a local runtime: no key, and the air gap is irrelevant to it. */
const isLoopback = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
};

export const readRoute = (env: BrainEnv): BrainRoute | null => {
  const kind = env.SI_PROVIDER;
  if (kind !== 'anthropic' && kind !== 'openai') return null;
  const baseUrl = env.SI_BASE_URL?.trim() || (kind === 'anthropic' ? 'https://api.anthropic.com' : '');
  if (!baseUrl) throw new BrainConfigError('SI_BASE_URL is required for the openai provider (Ollama, llama.cpp, vLLM, OpenRouter)');
  const local = isLoopback(baseUrl);
  const model: ModelRef = {
    id: `${kind}:${env.SI_MODEL ?? (kind === 'anthropic' ? 'claude-sonnet-4-5' : 'local')}`,
    provider: kind,
    model: env.SI_MODEL ?? (kind === 'anthropic' ? 'claude-sonnet-4-5' : 'local'),
    locality: local ? 'local' : 'cloud',
    // A local runtime may hold anything the Space allows; a cloud one is capped by policy below.
    maxConf: local ? 'restricted' : asConf(env.SI_CLOUD_CEILING, 'internal'),
    baseUrl,
  };
  return { kind, model, airGap: env.SI_AIRGAP === '1' || env.SI_AIRGAP === 'true' };
};

/**
 * Builds the brain, or returns null when no provider is configured. The ledger is the Space's, so every
 * model call lands in the same chain as the effects it proposed.
 */
export const createBrain = (env: BrainEnv, ledger: Ledger): Brain | null => {
  const route = readRoute(env);
  if (!route) return null;
  const apiKey = env.SI_API_KEY?.trim();
  if (route.model.locality === 'cloud' && !apiKey) {
    throw new BrainConfigError(`SI_API_KEY is required for the ${route.kind} provider at ${route.model.baseUrl}`);
  }

  const providers: Record<string, ModelProvider> =
    route.kind === 'anthropic'
      ? { anthropic: new AnthropicProvider() }
      : { openai: new OpenAICompatProvider() };

  // The brain plans; it never gets a role that can write. Writes happen as committed ChangeSets only.
  const roles: Record<Role, string[]> = {
    planner: [route.model.id],
    worker: [route.model.id],
    judge: [],
    reader: [route.model.id],
    summarizer: [],
    embedder: [],
  };
  const policy: RouterPolicy = {
    airGap: route.airGap,
    maxCloudConf: asConf(env.SI_CLOUD_CEILING, 'internal'),
    roles,
  };

  const gateway = new ModelGateway({
    models: [route.model],
    policy,
    providers,
    vault: new MemoryVault(apiKey ? { [route.model.id]: apiKey } : {}),
    ledger,
  });

  return {
    chip: route.model.locality === 'local' ? 'Local' : `Cloud: ${route.kind}`,
    modelId: route.model.id,
    route,
    async complete(messages, tools, signal) {
      if (signal.aborted) throw new Error('aborted');
      return gateway.complete({
        role: 'planner',
        messages: [...messages],
        // Assembled by the caller from the turn's data, not from the model's own claims.
        label: { conf: 'public', integrity: 'trusted', provenance: [`space:${route.kind}`] },
        tools,
      });
    },
  };
};

/** One line for boot logs and the health endpoint. Never includes a key. */
export const describeBrain = (brain: Brain | null): string =>
  brain ? `${brain.chip} · ${brain.modelId}${brain.route.airGap ? ' · air gap on' : ''}` : 'deterministic planner (no provider configured)';
