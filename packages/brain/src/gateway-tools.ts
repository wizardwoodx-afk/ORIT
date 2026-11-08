/**
 * SelfImpulse — tools over the governed broker.
 *
 * Every tool here is a thin translation of one broker call. There is no fallback path, no direct
 * filesystem access, and no retry: if the gateway denies, the denial is the observation. That is the
 * entire point — the agent's reach is exactly the scope a human signed for.
 */
import type { Broker, ExecResult } from '@si/gateway';
import type { Rehearsal } from '@si/changeset';
import { randomId } from '@si/core';
import type { Tool } from './tools.ts';

/** The slice of the broker the tools use. Narrow on purpose: a tool cannot mint authority. */
export type ToolBroker = Pick<Broker, 'call'>;

const call = (broker: ToolBroker, tool: string, args: Record<string, unknown>): Promise<ExecResult> =>
  broker.call({ id: randomId(8), tool, args, nodeId: 'agent', step: 0 });

/** ExecResult to an observation. A denial or an error is information, not an exception. */
const describe = (result: ExecResult): { ok: boolean; summary: string } => {
  switch (result.kind) {
    case 'ok': {
      const value = result.value;
      if (typeof value === 'string') return { ok: true, summary: value };
      if (typeof value === 'object' && value !== null && 'content' in value && typeof value.content === 'string') {
        return { ok: true, summary: value.content };
      }
      return { ok: true, summary: JSON.stringify(value ?? null) };
    }
    case 'ask':
      return { ok: false, summary: `needs a signature: ${result.reason}` };
    case 'denied':
      return { ok: false, summary: `denied by ${result.layer}: ${result.reason}` };
    case 'error':
      return { ok: false, summary: `error from ${result.name}: ${result.message}` };
  }
};

export const readFileTool = (broker: ToolBroker): Tool => ({
  spec: {
    name: 'read_file',
    description: 'Read one file from the Space as it is now. Returns the exact text, or a denial.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  effectClass: 'read',
  recoveryClass: 'R0',
  async run(args) {
    const path = String(args.path ?? '');
    // Reads come from the live tree: the agent must see what is actually there, not the change it is
    // building. Reads are read-only in every phase, so this cannot become an edit path.
    const result = await call(broker, 'fs.read', { path });
    return describe(result);
  },
});

/** The only tool that changes anything, and it changes the shadow, never the world. */
export const writeFileTool = (rehearsal: Rehearsal): Tool => ({
  spec: {
    name: 'write_file',
    description:
      'Write a file into the rehearsed change. The human signs this exact content before it becomes real.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: 'The complete file content.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  effectClass: 'sandbox',
  recoveryClass: 'R1',
  async run(args) {
    const path = String(args.path ?? '');
    const content = String(args.content ?? '');
    await rehearsal.stageWrite(path, content);
    return { ok: true, summary: `staged ${path} (${content.length} bytes) in the shadow copy` };
  },
});

/**
 * The tool set for a rehearsal phase. Reads come from the shadow (what the agent is about to change),
 * writes go into the change set. There is no live-write tool in this list, by construction.
 */
export const rehearsalTools = (broker: ToolBroker, rehearsal: Rehearsal): Tool[] => [
  readFileTool(broker),
  writeFileTool(rehearsal),
];
