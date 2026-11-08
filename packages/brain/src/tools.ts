/**
 * SelfImpulse — the tool host.
 *
 * A tool is three things: what the model is told about it, what the gateway will let it do, and how it
 * runs. Those three must not drift. The host refuses a tool whose advertisement is missing or whose
 * name is unknown, and it never lets a tool's failure escape as an exception into the loop — a failed
 * tool is an observation the model must see and reason about.
 */
import type { ToolSpec } from '@si/router';

export interface ToolContext {
  /** Aborted when the turn is cancelled or the client disconnects. Long tools must honour it. */
  readonly signal: AbortSignal;
  readonly step: number;
}

export interface ToolOutcome {
  readonly ok: boolean;
  /** What the model is told. Terse, factual, never a stack trace. */
  readonly summary: string;
}

export interface Tool {
  readonly spec: ToolSpec;
  /** Effect class and recovery class are what the approval shows a human. */
  readonly effectClass: 'read' | 'sandbox' | 'live';
  readonly recoveryClass: string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

export class UnknownToolError extends Error {
  constructor(readonly tool: string) {
    super(`unknown tool: ${tool}`);
  }
}

export class ToolHost {
  private readonly byName: Map<string, Tool>;

  constructor(tools: readonly Tool[]) {
    this.byName = new Map();
    for (const tool of tools) {
      if (this.byName.has(tool.spec.name)) throw new Error(`duplicate tool: ${tool.spec.name}`);
      this.byName.set(tool.spec.name, tool);
    }
  }

  /** Exactly what the provider is told, and exactly what the loop will accept. */
  get specs(): ToolSpec[] {
    return [...this.byName.values()].map((tool) => tool.spec);
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /**
   * Runs one call. Throwing here is reserved for a caller bug (an unknown name); a tool that fails
   * returns `ok: false`, because the model has to see the failure to recover from it.
   */
  async invoke(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
    const tool = this.byName.get(name);
    if (!tool) throw new UnknownToolError(name);
    try {
      return await tool.run(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool failed';
      return { ok: false, summary: `${name} failed: ${message}` };
    }
  }
}
