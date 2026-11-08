import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomId } from '@si/core';
import type { ToolManifest } from './manifest.ts';
import { resolveInside } from './paths.ts';
import type { Ticket, TicketVerifier } from './tickets.ts';

export interface WorkerResult {
  value: unknown;
  afterHash?: string | null;
}
export interface Worker {
  readonly id: string;
  run(ticket: Ticket, manifest: ToolManifest, args: Record<string, unknown>): Promise<WorkerResult>;
  terminateAll(): Promise<{ remaining: number }>;
}

export class PreconditionFailed extends Error {
  constructor(
    readonly path: string,
    readonly expected: string | null,
    readonly actual: string | null,
  ) {
    super(`precondition failed for ${path}`);
  }
}

const MAX_READ = 5 * 1024 * 1024;
export const hashBytes = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** File worker. Instances exist per root: "fs" is the live workspace, "shadow" is the rehearsal copy. */
export class FsWorker implements Worker {
  constructor(
    readonly id: 'fs' | 'shadow',
    private readonly root: string,
    private readonly verifier: TicketVerifier,
  ) {}

  private async currentHash(abs: string): Promise<string | null> {
    try {
      return hashBytes(await readFile(abs));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async run(ticket: Ticket, manifest: ToolManifest, args: Record<string, unknown>): Promise<WorkerResult> {
    this.verifier.verify(ticket, manifest.name, args);
    const rel = String(args.path);
    const abs = await resolveInside(this.root, rel);
    const verb = manifest.name.split('.')[1];
    if (verb === 'read') {
      const st = await stat(abs);
      if (!st.isFile() || st.size > MAX_READ) throw new Error('read: not a regular file or too large');
      const buf = await readFile(abs);
      return { value: { content: buf.toString('utf8'), size: buf.length, hash: hashBytes(buf) }, afterHash: hashBytes(buf) };
    }
    const before = await this.currentHash(abs);
    if ('expectBeforeHash' in args && args.expectBeforeHash !== undefined && args.expectBeforeHash !== before)
      throw new PreconditionFailed(rel, (args.expectBeforeHash as string | null) ?? null, before);
    if (verb === 'write') {
      const data = Buffer.from(String(args.content), 'utf8');
      await mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.${randomId(4)}.tmp`;
      await writeFile(tmp, data, { flag: 'wx', mode: 0o600 });
      await rename(tmp, abs);
      return { value: { path: rel, bytes: data.length }, afterHash: hashBytes(data) };
    }
    if (verb === 'delete') {
      if (before === null) throw new Error('delete: file does not exist');
      await unlink(abs);
      return { value: { path: rel }, afterHash: null };
    }
    throw new Error('worker: unsupported verb');
  }

  async terminateAll(): Promise<{ remaining: number }> {
    return { remaining: 0 }; // in-process worker: no child processes to reap
  }
}
