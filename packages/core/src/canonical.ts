/**
 * Deterministic JSON for hashing and signing (a strict subset of RFC 8785).
 * Rejected on purpose: undefined-as-value, non-finite numbers, and integer-like object keys
 * (JS reorders those, which would break cross-language canonical form).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonical: non-finite number');
    return v;
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (/^\d+$/.test(key)) throw new Error('canonical: integer-like object key');
      const val = src[key];
      if (val === undefined) continue;
      out[key] = normalize(val);
    }
    return out;
  }
  throw new Error(`canonical: unsupported type ${typeof v}`);
}
