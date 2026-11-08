/**
 * Resource patterns are exact strings or a prefix ending in "/**".
 * Callers must normalize resources first (no "..", no duplicate slashes); this module rejects them.
 */
export function isSafeResource(r: string): boolean {
  if (r.includes('\0') || r.includes('//')) return false;
  const body = r.replace(/\/\*\*$/, '/');
  return !body.split('/').includes('..');
}

const prefixOf = (p: string): string | null => (p.endsWith('/**') ? p.slice(0, -2) : null);

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
