/**
 * SelfImpulse — the model-driven turn.
 *
 * Same envelope as the template, with the plan coming from a model instead of a function: Frame, then
 * the brain works inside the rehearsal (reads are free and read-only; writes land in the shadow copy),
 * then the human signs the exact change set, and the kernel replays it. The brain never receives the
 * commit broker, and it cannot see a key, a grant, or the ledger.
 *
 * If the model proposes no change, there is nothing to sign. That is a real outcome, so it is reported
 * as one: the turn answers in words, and the state says why.
 */
import { randomId } from '@si/core';
import { Rehearsal, verifyChangeSetIntegrity } from '@si/changeset';
import { type OrderAuthority, type OrderRevision, type ScopeEntry, makeRevision } from '@si/gateway';
import type { ChatMessage, ToolSpec } from '@si/router';
import { type AgentEvent, ToolHost, buildSystemPrompt, rehearsalTools, runAgent } from '@si/brain';
import { SIGNATURE, say } from '@si/voice';
import type { ApprovalDesk } from './approvals.ts';
import type { GovernedSpace } from './boot.ts';
import type { Brain } from './model.ts';
import type { PlanStep, Thread } from './thread.ts';
import { GovernedTurn } from './turn-core.ts';

export class AgentTurnRunner extends GovernedTurn {
  constructor(
    space: GovernedSpace,
    thread: Thread,
    approvals: ApprovalDesk,
    private readonly brain: Brain,
    private readonly workspace: () => Promise<readonly string[]> = async () => [],
    now: () => number = Date.now,
  ) {
    super(space, thread, approvals, now);
  }

  start(text: string): { turnId: string } {
    const turnId = randomId(6);
    this.thread.append({
      type: 'message',
      turnId,
      actor: 'user',
      text,
      conf: this.space.config.policyCeiling,
      integrity: 'user',
    });
    void this.run(turnId, text).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.thread.append({ type: 'notice', turnId, text: say.failed('AgentTurn', message), tone: 'danger' });
      this.state(turnId, 'agent', 'failed');
    });
    return { turnId };
  }

  private async run(turnId: string, text: string): Promise<void> {
    const { gw, orders, agent, config } = this.space;
    const authorityBase: Omit<OrderAuthority, 'scope' | 'changeSetHash'> = {
      spaceId: config.id,
      policyVersion: 'si-1',
      budget: { toolCalls: 40, tokens: 20_000 },
      successChecks: ['content-matches:rehearsed-ops'],
      labelCeiling: config.policyCeiling,
    };

    this.state(turnId, 'frame', 'framed');

    // Rehearsal scope: reads anywhere in the Space, writes only into the shadow copy. Both are prefix
    // grants because the model chooses paths at runtime; neither reaches the live tree.
    const sandboxScope: ScopeEntry[] = [
      { tool: 'fs.read', ops: ['read'], resource: 'fs:**' },
      { tool: 'shadow.read', ops: ['read'], resource: 'shadow:**' },
      { tool: 'shadow.write', ops: ['write'], resource: 'shadow:**' },
    ];

    const rev0: OrderRevision = makeRevision(
      `${config.id}-${turnId}`,
      0,
      { ...authorityBase, scope: sandboxScope },
      { phase: 'rehearse', tool: this.brain.modelId },
    );
    orders.activateSandboxOnly(rev0, gw.manifests);
    gw.activateBudget(rev0);
    const session0 = this.session(rev0, agent.publicB64, 'REHEARSE', gw.mintGrants(rev0, agent.publicB64));

    this.state(turnId, 'rehearse', 'rehearsing');
    const rehearsal = new Rehearsal(gw.broker(session0), 'rehearse');
    const tools = rehearsalTools(gw.broker(session0), rehearsal);
    const host = new ToolHost(tools);
    const meta = new Map(tools.map((tool) => [tool.spec.name, tool]));

    const files = await this.workspace().catch(() => null);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          space: `${config.label} (${config.id})`,
          policyCeiling: config.policyCeiling,
          dial: config.dial,
          tools: host.specs,
          workspace: files,
        }),
      },
      { role: 'user', content: text },
    ];

    const observed: Array<{ tool: string; args: Readonly<Record<string, unknown>>; ok: boolean }> = [];
    const controller = new AbortController();
    let providerFailure: string | null = null;

    const result = await runAgent({
      messages,
      tools: host,
      limits: { maxSteps: 6, maxTokens: 24_000, maxToolCallsPerStep: 4 },
      signal: controller.signal,
      complete: async (msgs: ChatMessage[], specs: readonly ToolSpec[], signal: AbortSignal) => {
        try {
          return await this.brain.complete(msgs, specs, signal);
        } catch (error) {
          providerFailure = error instanceof Error ? error.message : 'provider failed';
          throw error;
        }
      },
      onEvent: (event: AgentEvent) => {
        if (event.type === 'observation') observed.push({ tool: event.name, args: {}, ok: event.ok });
      },
    });

    if (providerFailure) {
      this.state(turnId, 'rehearse', 'blocked');
      this.thread.append({
        type: 'notice',
        turnId,
        text: `No model route answered: ${providerFailure}. Nothing was staged and nothing was signed.`,
        tone: 'danger',
      });
      return;
    }

    const cs = rehearsal.build();

    // The plan shown to the human is what the turn did, not what it hoped to do.
    const planSteps: PlanStep[] = cs.ops.map((op, index) => {
      const writer = meta.get('write_file');
      return {
        id: `agent-write-${index}`,
        title: `Write ${op.path}`,
        tool: 'shadow.write',
        effectClass: writer?.effectClass ?? 'sandbox',
        recoveryClass: writer?.recoveryClass ?? 'R1',
        resource: `shadow:${op.path}`,
      };
    });
    if (planSteps.length > 0) {
      this.thread.append({ type: 'plan', turnId, steps: planSteps, changeSetHash: cs.hash });
    }

    if (result.stop === 'aborted') {
      this.state(turnId, 'rehearse', 'cancelled');
      this.thread.append({ type: 'notice', turnId, text: say.cancelled(), tone: 'info' });
      return;
    }

    if (cs.ops.length === 0) {
      // No effect was proposed, so there is nothing to sign and nothing to receipt. Said plainly.
      const why =
        result.stop === 'budget'
          ? 'The token budget ran out before the model proposed a change.'
          : result.stop === 'steps'
            ? 'The step limit was reached before the model proposed a change.'
            : 'The model answered without proposing a change.';
      this.state(turnId, 'answer', 'completed', 'Answered in words. Nothing needed a signature.');
      this.thread.append({
        type: 'message',
        turnId,
        actor: 'assistant',
        text: result.text.length > 0 ? result.text : why,
        conf: config.policyCeiling,
        integrity: 'untrusted',
      });
      this.thread.append({ type: 'notice', turnId, text: `${why} Nothing was staged.`, tone: 'info' });
      return;
    }

    const integrity = verifyChangeSetIntegrity(cs);
    if (integrity) throw new Error(integrity);

    if (result.stop === 'budget' || result.stop === 'steps' || result.stop === 'error') {
      this.thread.append({
        type: 'notice',
        turnId,
        text: `The brain stopped early (${result.stop})${result.detail ? `: ${result.detail}` : ''}. What was staged is in the change set below.`,
        tone: 'attn',
      });
    }

    await this.land({
      turnId,
      changeSet: cs,
      rev0,
      authorityBase,
      ...(result.text.length > 0 ? { finalText: result.text } : {}),
    });

    this.thread.append({
      type: 'notice',
      turnId,
      text: `${SIGNATURE.mark} ${result.steps} model step${result.steps === 1 ? '' : 's'} · ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'} · ${result.usage.input + result.usage.output} tokens · ${observed.filter((entry) => !entry.ok).length} refused`,
      tone: 'info',
    });
  }
}
