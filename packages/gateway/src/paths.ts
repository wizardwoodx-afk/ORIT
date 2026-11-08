import { lstat, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

/** Normalizes a model-supplied relative path. Throws on anything that could escape the workspace. */
export function normalizeRelPath(p: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024) throw new Error('path: invalid');
  if (p.includes('\0') || p.includes('\\')) throw new Error('path: invalid character');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new Error('path: absolute paths are not allowed');
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.includes('..')) throw new Error('path: traversal is not allowed');
  return parts.join('/');
}

/**
 * Resolves inside `root`, rejecting symlinks in any existing component.
 * A residual time-of-check window remains, which is why real workers also run in an OS sandbox.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const norm = normalizeRelPath(rel);
  const realRoot = await realpath(root);
  let cur = realRoot;
  for (const part of norm.split('/')) {
    cur = join(cur, part);
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) throw new Error('path: symlink rejected');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
  }
  if (cur !== realRoot && !cur.startsWith(realRoot + sep)) throw new Error('path: escapes root');
  return cur;
}
