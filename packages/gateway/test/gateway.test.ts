import { describe, expect, it } from 'vitest';
import { newKeyPair, signString } from '@si/core';
import { type Approval, approvalPayload, argsHashOf, classifyReplan, humanSign, makeRevision, type Worker } from '../src/index.ts';
import { makeEnv, openRehearsal } from './env.ts';

let n = 0;
const call = (tool: string, args: Record<string, unknown>, step = n++) => ({ id: `c${step}`, tool, args, nodeId: 'n1', step });

describe('phase gate', () => {
  it('denies everything in FRAME, allows reads in PROBE, sandbox writes only in REHEARSE', async () => {
    const env = await makeEnv();
    const { session, broker } = openRehearsal(env);
    session.phase = 'FRAME';
    expect((await broker.call(call('fs.read', { path: 'src/a.ts' }))).kind).toBe('denied');
    session.phase = 'PROBE';
    const r = await broker.call(call('fs.read', { path: 'src/a.ts' }));
    expect(r.kind).toBe('ok');
    expect((await broker.call(call('shadow.write', { path: 'src/a.ts', content: 'x' }))).kind).toBe('denied');
    session.phase = 'REHEARSE';
    const w = await broker.call(call('shadow.write', { path: 'src/a.ts', content: 'x' }));
    expect(w.kind).toBe('ok');
    const live = await broker.call(call('fs.write', { path: 'src/a.ts', content: 'x' }));
    expect(live).toMatchObject({ kind: 'denied', layer: 'phase' });
    expect(await env.read('src/a.ts')).toBe('export const a = 1;\n');
  });
});

describe('authority', () => {
  it('has no authority without grants and rejects a caller that is not the grant holder', async () => {
    const env = await makeEnv();
    const { r0 } = openRehearsal(env);
    const none = env.gw.openSession({ orderId: 'order-1', callerPubB64: env.agent.publicB64, dial: 3, phase: 'PROBE', chains: [] });
    expect((await env.gw.broker(none).call(call('fs.read', { path: 'src/a.ts' }))).kind).toBe('denied');
    const thief = newKeyPair();
    const stolen = env.gw.openSession({ orderId: 'order-1', callerPubB64: thief.publicB64, dial: 3, phase: 'PROBE', chains: env.gw.mintGrants(r0, env.agent.publicB64) });
    expect(await env.gw.broker(stolen).call(call('fs.read', { path: 'src/a.ts' }))).toMatchObject({ kind: 'denied', reason: 'grant holder does not match caller' });
  });

  it('keeps credential files unreadable even with a covering grant', async () => {
    const env = await makeEnv();
    const { broker } = openRehearsal(env);
    expect(await broker.call(call('fs.read', { path: '.env' }))).toMatchObject({ kind: 'denied' });
    expect(await broker.call(call('fs.read', { path: '../outside' }))).toMatchObject({ kind: 'denied', layer: 'resource' });
  });

  it('applies hard policy denies above grants', async () => {
    const env = await makeEnv({ denyResources: ['fs:src/a.ts'] });
    const { broker } = openRehearsal(env);
    expect(await broker.call(call('fs.read', { path: 'src/a.ts' }))).toMatchObject({ kind: 'denied', layer: 'policy' });
  });

  it('enforces the order budget', async () => {
    const env = await makeEnv();
    const { r0, session } = openRehearsal(env);
    env.gw.budget.init(r0.orderId, { toolCalls: 1, tokens: 0 });
    const b = env.gw.broker(session);
    expect((await b.call(call('fs.read', { path: 'src/a.ts' }))).kind).toBe('ok');
    expect(await b.call(call('fs.read', { path: 'src/a.ts' }))).toMatchObject({ kind: 'denied', layer: 'budget' });
  });
});

describe('commit authority', () => {
  it('requires a human-signed revision, and an agent signature is not accepted', async () => {
    const env = await makeEnv();
    const { r0 } = openRehearsal(env);
    const scope = [{ tool: 'fs.write' as const, ops: ['write' as const], resource: 'fs:src/**' }];
    const forged = makeRevision('order-1', 1, { spaceId: 'space-a', policyVersion: 'p1', budget: { toolCalls: 5, tokens: 0 }, successChecks: [], labelCeiling: 'confidential', scope }, {}, r0);
    forged.signatures.push({ keyId: env.agent.id, sig: signString(env.agent.privateKey, 'whatever') });
    expect(() => env.orders.activate(forged)).toThrow('not enough valid human signatures');
    expect(() => env.orders.activateSandboxOnly(forged, env.gw.manifests)).toThrow('human signature required');
  });

  it('commits a live write after a signed revision and refuses once the revision is superseded', async () => {
    const env = await makeEnv();
    const { r0, session } = openRehearsal(env);
    const r1 = env.signedRev([{ tool: 'fs.write', ops: ['write'], resource: 'fs:src/**' }], r0);
    env.orders.activate(r1);
    env.gw.activateBudget(r1);
    session.chains = env.gw.mintGrants(r1, env.agent.publicB64);
    session.phase = 'COMMIT';
    const b = env.gw.broker(session);
    const w = await b.call(call('fs.write', { path: 'src/a.ts', content: 'export const a = 2;\n' }));
    expect(w.kind).toBe('ok');
    expect(await env.read('src/a.ts')).toBe('export const a = 2;\n');
    const r2 = env.signedRev([{ tool: 'fs.write', ops: ['write'], resource: 'fs:docs/**' }], r1);
    env.orders.activate(r2);
    expect(await b.call(call('fs.write', { path: 'src/a.ts', content: 'late' }))).toMatchObject({ kind: 'denied', layer: 'grant' });
  });

  it('requires two distinct signatures when the Space asks for four eyes', async () => {
    const h2 = newKeyPair();
    const h1 = newKeyPair();
    const env = await makeEnv({ requiredApprovals: 2, humans: [h1, h2] });
    const r0 = env.rev0();
    env.orders.activateSandboxOnly(r0, env.gw.manifests);
    const r1 = makeRevision('order-1', 1, { spaceId: 'space-a', policyVersion: 'p1', budget: { toolCalls: 5, tokens: 0 }, successChecks: [], labelCeiling: 'confidential', scope: [] }, {}, r0);
    r1.signatures.push(humanSign(r1, h1), humanSign(r1, h1));
    expect(() => env.orders.activate(r1)).toThrow();
    r1.signatures.push(humanSign(r1, h2));
    expect(() => env.orders.activate(r1)).not.toThrow();
  });
});

describe('tickets', () => {
  it('rejects tickets with changed arguments, wrong tool, and replays', async () => {
    const env = await makeEnv();
    const { session } = openRehearsal(env);
    const c = call('fs.read', { path: 'src/a.ts' });
    const d = await env.gw.decide(session, c);
    if (d.kind !== 'allow') throw new Error('expected allow');
    const v = env.gw.ticketVerifierFor('fs');
    expect(() => v.verify(d.ticket, 'fs.read', { path: 'src/other.ts' })).toThrow('arguments changed');
    expect(() => v.verify(d.ticket, 'fs.write', { path: 'src/a.ts' })).toThrow('wrong tool');
    expect(() => v.verify(d.ticket, 'fs.read', { path: 'src/a.ts' })).not.toThrow();
    expect(() => v.verify(d.ticket, 'fs.read', { path: 'src/a.ts' })).toThrow('replay');
  });
});

describe('dial, approvals and information flow', () => {
  const mailWorker = (sent: string[]): Worker => ({
    id: 'mail',
    async run(_t, _m, args) { sent.push(String(args.to)); return { value: { ok: true } }; },
    async terminateAll() { return { remaining: 0 }; },
  });

  const withMail = async (restrictedContext = false) => {
    const sent: string[] = [];
    const env = await makeEnv({ extraWorkers: [mailWorker(sent)] });
    const { r0, session } = openRehearsal(env, 4);
    const r1 = env.signedRev([{ tool: 'mail.send', ops: ['send'], resource: 'mail:finance@corp.test' }], r0, restrictedContext ? { labelCeiling: 'restricted' } : {});
    env.orders.activate(r1);
    env.gw.activateBudget(r1);
    session.chains = env.gw.mintGrants(r1, env.agent.publicB64);
    session.phase = 'COMMIT';
    if (restrictedContext) session.contextLabel = { conf: 'restricted', integrity: 'user', provenance: ['secret'] };
    return { env, session, sent };
  };
  const approve = (env: Awaited<ReturnType<typeof makeEnv>>, kind: Approval['kind'], c: ReturnType<typeof call>) => {
    const argsHash = argsHashOf(c.args);
    const a: Approval = { kind, callId: c.id, argsHash, keyId: env.human.id, sig: '' };
    return env.gw.addApproval({ ...a, sig: signString(env.human.privateKey, approvalPayload(a)) });
  };

  it('never auto-runs R3 actions, even at dial 4, until a human approves the exact arguments', async () => {
    const { env, session, sent } = await withMail();
    const c = call('mail.send', { to: 'finance@corp.test', subject: 's', body: 'b' });
    const first = await env.gw.broker(session).call(c);
    expect(first.kind).toBe('ask');
    expect(sent).toHaveLength(0);
    // an approval for different arguments does not help
    const other = { ...c, args: { ...c.args, body: 'changed' } };
    approve(env, 'approve', other);
    expect((await env.gw.broker(session).call(c)).kind).toBe('ask');
    approve(env, 'approve', c);
    expect((await env.gw.broker(session).call(c)).kind).toBe('ok');
    expect(sent).toEqual(['finance@corp.test']);
  });

  it('treats approval as different from declassification', async () => {
    const { env, session, sent } = await withMail(true);
    const c = call('mail.send', { to: 'finance@corp.test', subject: 's', body: 'b' });
    approve(env, 'approve', c);
    expect(await env.gw.broker(session).call(c)).toMatchObject({ kind: 'denied', layer: 'ifc' });
    approve(env, 'declassify', c);
    expect((await env.gw.broker(session).call(c)).kind).toBe('ok');
    expect(sent).toHaveLength(1);
  });

  it('rejects approvals signed by keys that are not registered humans', async () => {
    const { env } = await withMail();
    const rogue = newKeyPair();
    const c = call('mail.send', { to: 'finance@corp.test', subject: 's', body: 'b' });
    const a: Approval = { kind: 'approve', callId: c.id, argsHash: argsHashOf(c.args), keyId: rogue.id, sig: '' };
    expect(env.gw.addApproval({ ...a, sig: signString(rogue.privateKey, approvalPayload(a)) })).toBe(false);
  });

  it('asks instead of allowing a live write when the context is untrusted', async () => {
    const env = await makeEnv();
    const { r0, session } = openRehearsal(env, 3);
    const r1 = env.signedRev([{ tool: 'fs.write', ops: ['write'], resource: 'fs:src/**' }], r0);
    env.orders.activate(r1);
    env.gw.activateBudget(r1);
    session.chains = env.gw.mintGrants(r1, env.agent.publicB64);
    session.phase = 'COMMIT';
    session.contextLabel = { conf: 'public', integrity: 'untrusted', provenance: ['web'] };
    expect((await env.gw.broker(session).call(call('fs.write', { path: 'src/a.ts', content: 'x' }))).kind).toBe('ask');
  });
});

describe('labels follow data automatically', () => {
  it('raises the context label when a file with a secret is read', async () => {
    const env = await makeEnv();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${env.live}/src/k.ts`, 'const k = "AKIAABCDEFGHIJKLMNOP";\n');
    const { session, broker } = openRehearsal(env);
    const r = await broker.call(call('fs.read', { path: 'src/k.ts' }));
    expect(r.kind).toBe('ok');
    expect(session.contextLabel.conf).toBe('restricted');
  });
});

describe('kill switch and failure handling', () => {
  it('denies everything after kill and records the residue count', async () => {
    const env = await makeEnv();
    const { broker } = openRehearsal(env);
    const k = await env.gw.kill();
    expect(k.remainingWorkers).toBe(0);
    expect(await broker.call(call('fs.read', { path: 'src/a.ts' }))).toMatchObject({ kind: 'denied', layer: 'kill' });
    expect(env.ledger.events().some((e) => e.kind === 'kill')).toBe(true);
  });

  it('fails closed on malformed calls and records every decision in the ledger', async () => {
    const env = await makeEnv();
    const { broker } = openRehearsal(env);
    expect((await broker.call({ id: '', tool: 'fs.read', args: {}, nodeId: 'n', step: 0 })).kind).toBe('denied');
    expect((await broker.call(call('nope.tool', {}))).kind).toBe('denied');
    expect((await broker.call(call('fs.read', { path: 5 }))).kind).toBe('denied');
    expect(env.ledger.events().filter((e) => e.kind === 'decision').length).toBeGreaterThanOrEqual(3);
    expect(env.ledger.verifyChain()).toEqual({ ok: true });
  });
});

describe('replan classification', () => {
  it('A for plan-only, C for narrowing, B for new authority or weakened checks', async () => {
    const env = await makeEnv();
    const base = env.rev0();
    const a = { ...base.authority };
    const mk = (auth: typeof a, plan: unknown) => makeRevision('order-1', 1, auth, plan, base);
    expect(classifyReplan(base, mk(a, { different: true }))).toBe('A');
    expect(classifyReplan(base, mk({ ...a, scope: a.scope.slice(0, 1) }, {}))).toBe('C');
    expect(classifyReplan(base, mk({ ...a, scope: [...a.scope, { tool: 'fs.write', ops: ['write'], resource: 'fs:src/**' }] }, {}))).toBe('B');
    expect(classifyReplan(base, mk({ ...a, successChecks: [] }, {}))).toBe('B');
    expect(classifyReplan(base, mk({ ...a, budget: { ...a.budget, toolCalls: 999 } }, {}))).toBe('B');
  });
});
