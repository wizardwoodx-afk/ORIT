/**
 * Resource patterns are exact strings, a directory prefix ending in "/**" (`fs:notes/**` matches
 * `fs:notes/a.md`), or a scheme-wide prefix ending in "**" (`fs:**` matches everything under `fs:`).
 * The scheme-wide form exists because an agent chooses paths at runtime: its rehearsal grant has to
 * name the whole tree, and "no grant" would have been the only alternative.
 * Callers must normalize resources first (no "..", no duplicate slashes); this module rejects them.
 */
export function isSafeResource(r: string): boolean {
  if (r.includes('\0') || r.includes('//')) return false;
  // Traversal can hide behind the scheme prefix (`fs:../etc/passwd`), so the check runs on both the
  // whole string and the part after the scheme.
  const body = r.replace(/\*+$/, '');
  const afterScheme = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body;
  return !body.split('/').includes('..') && !afterScheme.split('/').includes('..');
}

const prefixOf = (p: string): string | null => (p.endsWith('**') ? p.slice(0, -2) : null);

export function matchesResource(pattern: string, resource: string): boolean {
  if (!isSafeResource(resource)) return false;
  const pre = prefixOf(pattern);
  return pre !== null ? resource.startsWith(pre) : pattern === resource;
}

/** Is `child` no broader than `parent`? */
export function patternSubset(child: string, parent: string): boolean {
  if (!isSafeResource(child) || !isSafeResource(parent)) return false;
  const pp = prefixOf(parent);
  if (pp === null) return child === parent;
  const cp = prefixOf(child);
  return (cp ?? child).startsWith(pp);
}
