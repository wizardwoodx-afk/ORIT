import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyBuffer, classifyFile, luhn, verhoeff } from '../src/index.ts';

const policy = { defaultConf: 'internal', maxCloudConf: 'internal' } as const;
const cb = (p: string, text: string) => classifyBuffer(p, Buffer.from(text), text.length, policy);

describe('classifier', () => {
  it('treats .env as restricted and unreadable but .env.example as normal', () => {
    const e = cb('.env', 'A=1');
    expect(e.conf).toBe('restricted');
    expect(e.agentMayRead).toBe(false);
    expect(cb('.env.example', 'A=1').agentMayRead).toBe(true);
  });
  it('flags a planted AWS key and blocks cloud', () => {
    const c = cb('src/a.ts', 'const k = "AKIAABCDEFGHIJKLMNOP";');
    expect(c.conf).toBe('restricted');
    expect(c.mayLeaveDevice).toBe(false);
    expect(JSON.stringify(c)).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });
  it('validates card and Aadhaar checksums instead of guessing', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(verhoeff('234567890124')).toBe(verhoeff('234567890124'));
    expect(cb('d.txt', 'card 4111 1111 1111 1111').flags).toContain('pii:payment-card');
    expect(cb('d.txt', 'num 4111 1111 1111 1112').flags).not.toContain('pii:payment-card');
  });
  it('marks binaries opaque and generated files protected', () => {
    const b = classifyBuffer('a.bin', Buffer.from([0, 1, 2, 3]), 4, policy);
    expect(b.flags).toContain('opaque-binary');
    expect(b.mayLeaveDevice).toBe(false);
    expect(cb('dist/app.min.js', 'x').agentMayEdit).toBe(false);
    expect(cb('package-lock.json', '{}').collapseInDiff).toBe(true);
  });
  it('refuses a policy that lets restricted data leave the device', () => {
    expect(() => classifyBuffer('a', Buffer.alloc(0), 0, { defaultConf: 'internal', maxCloudConf: 'restricted' })).toThrow();
  });
});

describe('classifyFile safety', () => {
  it('rejects symlinks, traversal, and fails closed on large files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cls-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;');
    await writeFile(join(root, 'big.txt'), 'x'.repeat(70_000));
    await symlink('/etc/passwd', join(root, 'link'));
    await expect(classifyFile(root, 'link', policy)).rejects.toThrow('not-a-regular-file');
    await expect(classifyFile(root, '../x', policy)).rejects.toThrow('path-escape');
    const ok = await classifyFile(root, 'src/a.ts', policy);
    expect(ok.kind).toBe('source');
    const big = await classifyFile(root, 'big.txt', policy);
    expect(big.flags).toContain('partial-scan');
    expect(big.mayLeaveDevice).toBe(false);
  });
});
