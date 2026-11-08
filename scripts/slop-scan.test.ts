import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { scan } from './slop-scan.mjs';

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'slop-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c);
  return d;
};
describe('slop scanner', () => {
  it('flags the documented tells', () => {
    const d = dir({
      'tokens.css': ':root{--fg:#e6e6e3}',
      'a.css': '.x{background:linear-gradient(#fff,#000);box-shadow:0 0 8px red;border-radius:16px;font-family:Inter;color:#123456}',
    });
    const rules = scan(d).map((f: { rule: string }) => f.rule);
    for (const r of ['gradient', 'shadow', 'radius', 'font', 'color']) expect(rules).toContain(r);
  });
  it('passes clean token-based CSS', () => {
    expect(scan(dir({ 'tokens.css': ':root{--fg:#e6e6e3}', 'a.css': '.x{color:var(--fg);border-radius:4px}' }))).toEqual([]);
  });
});
