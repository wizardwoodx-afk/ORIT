import type {
  ActionClass,
  Conf,
  EffectClass,
  Op,
  RecoveryClass,
} from '@si/core';
import { z } from 'zod';
import { normalizeRelPath } from './paths.ts';

export interface ToolManifest {
  readonly name: string;
  /** Declared here, never taken from the model. The phase gate reads this field. */
  readonly effectClass: EffectClass;
  readonly actionClass: ActionClass;
  readonly recoveryClass: RecoveryClass;
  readonly op: Op;
  readonly worker: string;
  /** Highest confidentiality this tool's sink accepts. Local sinks accept everything; external sinks do not. */
  readonly sinkConf: Conf;
  readonly argsSchema: z.ZodType<Record<string, unknown>>;
  /** Canonical resource string used for grants and policy, e.g. "fs:src/a.ts". Throws on unsafe input. */
  resourceOf(args: Record<string, unknown>): string;
  /** Path-bearing tools are pre-classified before any byte is read or written. */
  readonly pathArg?: string;
}

const pathArgs = z.object({ path: z.string() });
const writeArgs = z.object({
  path: z.string(),
  content: z.string().max(2_000_000),
  expectBeforeHash: z.string().nullable().optional(),
});
const deleteArgs = z.object({ path: z.string(), expectBeforeHash: z.string().nullable().optional() });

const fsTool = (
  prefix: 'fs' | 'shadow',
  name: 'read' | 'write' | 'delete',
  schema: z.ZodType<Record<string, unknown>>,
): ToolManifest => ({
  name: `${prefix}.${name}`,
  effectClass: name === 'read' ? 'none' : prefix === 'shadow' ? 'sandbox' : 'live',
  actionClass: name === 'read' ? 'read' : 'edit',
  recoveryClass: 'R1',
  op: name,
  worker: prefix,
  sinkConf: 'restricted',
  argsSchema: schema,
  pathArg: 'path',
  resourceOf: (a) => `${prefix}:${normalizeRelPath(String(a.path))}`,
});

export const DEFAULT_MANIFESTS: readonly ToolManifest[] = [
  fsTool('fs', 'read', pathArgs),
  fsTool('fs', 'write', writeArgs),
  fsTool('fs', 'delete', deleteArgs),
  fsTool('shadow', 'read', pathArgs),
  fsTool('shadow', 'write', writeArgs),
  fsTool('shadow', 'delete', deleteArgs),
  {
    name: 'mail.send',
    effectClass: 'external',
    actionClass: 'external',
    recoveryClass: 'R3',
    op: 'send',
    worker: 'mail',
    sinkConf: 'internal',
    argsSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    resourceOf: (a) => `mail:${String(a.to).toLowerCase()}`,
  },
];

export class ManifestRegistry {
  private readonly byName = new Map<string, ToolManifest>();
  constructor(manifests: readonly ToolManifest[] = DEFAULT_MANIFESTS) {
    for (const m of manifests) this.byName.set(m.name, m);
  }
  get(name: string): ToolManifest | undefined {
    return this.byName.get(name);
  }
}
