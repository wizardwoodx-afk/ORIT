import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type KeyPair, newKeyPair } from '@si/core';
import { Ledger, localWitness } from '@si/ledger';
import {
  FsWorker, Gateway, ManifestRegistry, OrderRegistry, type OrderRevision, type Worker,
  humanSign, makeRevision, type Detent,
} from '../src/index.ts';

export interface Env {
  gw: Gateway; ledger: Ledger; orders: OrderRegistry; live: string; shadow: string;
  human: KeyPair; agent: KeyPair; rootKey: KeyPair; witness: ReturnType<typeof localWitness>;
  read(rel: string): Promise<string>;
  rev0(): OrderRevision;
  signedRev(scope: OrderRevision['authority']['scope'], parent: OrderRevision, extra?: Partial<OrderRevision['authority']>): OrderRevision;
}

export async function makeEnv(opts: { extraWorkers?: Worker[]; requiredApprovals?: number; humans?: KeyPair[]; denyResources?: string[] } = {}): Promise<Env> {
  const live = await mkdtemp(join(tmpdir(), 'live-'));
  const shadow = await mkdtemp(join(tmpdir(), 'shadow-'));
  await mkdir(join(live, 'src'), { recursive: true });
  await writeFile(join(live, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(live, '.env'), 'TOKEN=abc\n');
  const human = newKeyPair();
  const agent = newKeyPair();
  const rootKey = newKeyPair();
  const gatewayKey = newKeyPair();
  const witness = localWitness(newKeyPair());
  const ledger = new Ledger();
  const humans = opts.humans ?? [human];
  const orders = new OrderRegistry(new Map(humans.map((h) => [h.id, h.publicB64])), opts.requiredApprovals ?? 1);
  const manifests = new ManifestRegistry();
  const holder: { gw?: Gateway } = {};
  const lazy = (id: 'fs' | 'shadow', root: string) => {
    const verifierProxy = {
      verify: (...a: Parameters<ReturnType<Gateway['ticketVerifierFor']>['verify']>) => (holder.gw as Gateway).ticketVerifierFor(id).verify(...a),
    };
    return new FsWorker(id, root, verifierProxy as never);
  };
  const stable = new Map<string, ReturnType<Gateway['ticketVerifierFor']>>();
  const workers: Worker[] = [lazy('fs', live), lazy('shadow', shadow), ...(opts.extraWorkers ?? [])];
  // each worker needs ONE verifier so replay protection persists across calls
  const gw = new Gateway({
    spaceId: 'space-a', rootKey, gatewayKey, ledger, orders, manifests,
    policy: { version: 'p1', denyResources: opts.denyResources ?? [] },
    classifierPolicy: { defaultConf: 'internal', maxCloudConf: 'internal' },
    workers,
  });
  holder.gw = gw;
  for (const id of ['fs', 'shadow'] as const) stable.set(id, gw.ticketVerifierFor(id));
  (holder.gw as Gateway).ticketVerifierFor = (id: string) => stable.get(id) ?? gw.ticketVerifierFor(id);
  const baseAuthority = { spaceId: 'space-a', policyVersion: 'p1', budget: { toolCalls: 50, tokens: 100000 }, successChecks: ['c1'], labelCeiling: 'confidential' as const };
  const rev0 = () => makeRevision('order-1', 0, { ...baseAuthority, scope: [
    { tool: 'fs.read', ops: ['read'], resource: 'fs:**'.replace('**', '**').replace('fs:**', 'fs:src/**') },
    { tool: 'shadow.read', ops: ['read'], resource: 'shadow:src/**' },
    { tool: 'shadow.write', ops: ['write'], resource: 'shadow:src/**' },
    { tool: 'shadow.delete', ops: ['delete'], resource: 'shadow:src/**' },
  ] }, { phase: 'rehearse' });
  const signedRev = (scope: OrderRevision['authority']['scope'], parent: OrderRevision, extra: Partial<OrderRevision['authority']> = {}) => {
    const r = makeRevision('order-1', parent.rev + 1, { ...baseAuthority, scope, ...extra }, { phase: 'commit' }, parent);
    r.signatures.push(humanSign(r, human));
    return r;
  };
  return { gw, ledger, orders, live, shadow, human, agent, rootKey, witness, read: (rel) => readFile(join(live, rel), 'utf8'), rev0, signedRev };
}

export const openRehearsal = (env: Env, dial: Detent = 3) => {
  const r0 = env.rev0();
  env.orders.activateSandboxOnly(r0, env.gw.manifests);
  env.gw.activateBudget(r0);
  const chains = env.gw.mintGrants(r0, env.agent.publicB64);
  const session = env.gw.openSession({ orderId: 'order-1', callerPubB64: env.agent.publicB64, dial, phase: 'PROBE', chains });
  return { r0, session, broker: env.gw.broker(session) };
};
