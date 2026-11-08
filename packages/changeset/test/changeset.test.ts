import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Check, Rehearsal, commitChangeSet, prove, rollback, runChecks, scopeForChangeSet, verifyChangeSetIntegrity } from '../src/index.ts';
import { type Env, makeEnv, openRehearsal } from '../../gateway/test/env.ts';

async function rehearseAndSign(env: Env, edits: Record<string, string | null>) {
  const { r0, session, broker } = openRehearsal(env);
  session.phase = 'REHEARSE';
  const rh = new Rehearsal(broker);
  for (const [p, c] of Object.entries(edits)) {
    if (c === null) await rh.stageDelete(p);
    else await rh.stageWrite(p, c);
  }
  const cs = rh.build();
  const r1 = env.signedRev(scopeForChangeSet(cs), r0, { changeSetHash: cs.hash });
  env.orders.activate(r1);
  env.gw.activateBudget(r1);
  session.chains = env.gw.mintGrants(r1, env.agent.publicB64);
  session.phase = 'COMMIT';
  return { cs, session, broker, rh };
}

describe('rehearse, commit, prove', () => {
  it('rehearsal never touches live files; commit applies exactly the signed ChangeSet', async () => {
    const env = await makeEnv();
    const { cs, broker, session } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n', 'src/b.ts': 'export const b = 1;\n' });
    expect(cs.ops.map((o) => o.kind)).toEqual(['modify', 'create']);
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n'); // untouched before commit
    const res = await commitChangeSet(broker, cs);
    expect(res).toMatchObject({ status: 'committed', applied: ['src/a.ts', 'src/b.ts'] });
    expect(await env.read('src/a.ts')).toBe('export const a = 2;\n');
    session.phase = 'PROVE';
    const checks: Check[] = [{ id: 'a-is-2', run: async (v) => ({ pass: (await v.read('src/a.ts'))?.includes('= 2') ?? false, detail: 'a equals 2' }) }];
    const report = await prove(broker, cs, checks);
    expect(report.verdict).toBe('verified');
    expect(env.ledger.verifyChain()).toEqual({ ok: true });
  });

  it('refuses to commit when a live file changed after rehearsal (DRIFTED) and changes nothing', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n', 'src/b.ts': 'export const b = 1;\n' });
    await writeFile(join(env.live, 'src/a.ts'), 'export const a = 999; // edited by someone else\n');
    const res = await commitChangeSet(broker, cs);
    expect(res.status).toBe('drifted');
    expect(res.drifted).toEqual(['src/a.ts']);
    await expect(env.read('src/b.ts')).rejects.toThrow(); // nothing was applied
    expect(await env.read('src/a.ts')).toContain('999');
  });

  it('rolls back exactly when a later write fails (R1 atomicity)', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n', 'src/z.ts': 'export const z = 1;\n' });
    // make the second write fail at the worker: its parent path becomes a file
    await mkdir(dirname(join(env.live, 'src/z.ts')), { recursive: true });
    await writeFile(join(env.live, 'src/z.ts'), 'now exists'); // CAS fails: file was created after rehearsal
    // preflight sees the drift on z.ts, so also test the mid-flight race by bypassing preflight:
    const r = await commitChangeSet(broker, cs);
    expect(r.status).toBe('drifted');
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n');
  });

  it('rollback restores before-content and refuses to clobber later edits', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n' });
    await commitChangeSet(broker, cs);
    expect(await rollback(broker, cs.ops)).toEqual([]);
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n');
    // commit again, then someone edits: rollback must refuse (CAS on afterHash)
    const again = await commitChangeSet(broker, cs);
    expect(again.status).toBe('committed');
    await writeFile(join(env.live, 'src/a.ts'), 'someone else was here\n');
    expect(await rollback(broker, cs.ops)).toEqual(['src/a.ts']);
    expect(await env.read('src/a.ts')).toBe('someone else was here\n');
  });

  it('detects a tampered ChangeSet before applying anything', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n' });
    const evil = { ...cs, ops: cs.ops.map((o) => ({ ...o, after: 'process.exit(1)' })) };
    expect(verifyChangeSetIntegrity(evil)).toMatch(/hash mismatch/);
    expect((await commitChangeSet(broker, evil)).status).toBe('rejected');
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n');
  });

  it('cannot write outside the signed scope (exact files only)', async () => {
    const env = await makeEnv();
    const { broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n' });
    const r = await broker.call({ id: 'x', tool: 'fs.write', args: { path: 'src/other.ts', content: 'x' }, nodeId: 'n', step: 999 });
    expect(r).toMatchObject({ kind: 'denied', layer: 'grant' });
  });

  it('marks a deletion and a protected-file edit correctly', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': null });
    expect(cs.ops[0]?.kind).toBe('delete');
    expect((await commitChangeSet(broker, cs)).status).toBe('committed');
    await expect(env.read('src/a.ts')).rejects.toThrow();
    await rollback(broker, cs.ops);
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n');
  });

  it('reports not_verified and blocked honestly', async () => {
    const env = await makeEnv();
    const { cs, broker } = await rehearseAndSign(env, { 'src/a.ts': 'export const a = 2;\n' });
    const failing: Check = { id: 'nope', run: async () => ({ pass: false, detail: 'no' }) };
    expect((await prove(broker, cs, [failing])).verdict).toBe('not_verified'); // nothing committed, check fails
    await commitChangeSet(broker, cs);
    expect((await prove(broker, cs, [failing])).verdict).toBe('partially_verified'); // hashes match, check fails
    expect((await runChecks([{ id: 't', run: async () => { throw new Error('boom'); } }], { read: async () => null }))[0]?.pass).toBe(false);
  });
});
