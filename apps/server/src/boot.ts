/**
 * SelfImpulse — boot.
 *
 * Builds one governed Space: its own ledger, keys, ordering authority, workers and roots. The brain
 * never runs here; this is the trusted side, and it holds everything the brain is not allowed to see.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type KeyPair, newKeyPair } from '@si/core';
import {
  FsWorker,
  Gateway,
  ManifestRegistry,
  OrderRegistry,
  type Ticket,
  type TicketVerifier,
  type Worker,
} from '@si/gateway';
import { Ledger, type Witness, localWitness } from '@si/ledger';
import { SPACES, type SpaceConfig, type SpaceId } from './spaces.ts';

export interface GovernedSpace {
  readonly config: SpaceConfig;
  readonly gw: Gateway;
  readonly ledger: Ledger;
  readonly orders: OrderRegistry;
  readonly human: KeyPair;
  readonly agent: KeyPair;
  readonly rootKey: KeyPair;
  readonly gatewayKey: KeyPair;
  readonly witness: Witness;
  readonly liveRoot: string;
  readonly shadowRoot: string;
}

export interface BootOptions {
  /** Where ledgers, workspaces and thread logs live. Runtime data, never committed. */
  readonly dataRoot: string;
  readonly now?: () => number;
}

/**
 * Workers need a ticket verifier that only exists once the gateway is built, and each worker must
 * keep ONE verifier so replay protection survives across calls. The holder defers the lookup and
 * the cache keeps the instance stable.
 */
function deferredVerifiers(holder: { gw?: Gateway }): (worker: 'fs' | 'shadow') => TicketVerifier {
  const cache = new Map<string, TicketVerifier>();
  return (worker) => {
    const hit = cache.get(worker);
    if (hit) return hit;
    const gw = holder.gw;
    if (!gw) throw new Error('boot: worker used before the gateway existed');
    const made = gw.ticketVerifierFor(worker);
    cache.set(worker, made);
    return made;
  };
}

export async function bootSpace(id: SpaceId, opts: BootOptions): Promise<GovernedSpace> {
  const config = SPACES[id];
  const base = join(opts.dataRoot, id);
  const liveRoot = join(base, 'workspace');
  const shadowRoot = join(base, 'shadow');
  await mkdir(liveRoot, { recursive: true });
  await mkdir(shadowRoot, { recursive: true });

  const human = newKeyPair();
  const agent = newKeyPair();
  const rootKey = newKeyPair();
  const gatewayKey = newKeyPair();
  const witness = localWitness(newKeyPair());
  const ledger = new Ledger(join(base, 'ledger.db'), opts.now);
  const orders = new OrderRegistry(new Map([[human.id, human.publicB64]]), 1);

  const holder: { gw?: Gateway } = {};
  const verifierFor = deferredVerifiers(holder);
  const worker = (workerId: 'fs' | 'shadow', root: string): Worker =>
    new FsWorker(workerId, root, {
      // The scaffold is the worker's view of the gateway: it checks tickets and nothing else.
      verify: (ticket: Ticket, tool: string, args: Record<string, unknown>) =>
        verifierFor(workerId).verify(ticket, tool, args),
    } as unknown as TicketVerifier);

  const gw = new Gateway({
    spaceId: id,
    rootKey,
    gatewayKey,
    ledger,
    orders,
    manifests: new ManifestRegistry(),
    policy: { version: 'si-1', denyResources: [...config.denyResources] },
    classifierPolicy: { defaultConf: config.policyCeiling, maxCloudConf: 'internal' },
    workers: [worker('fs', liveRoot), worker('shadow', shadowRoot)],
    now: opts.now,
  });
  holder.gw = gw;

  ledger.append('space.booted', 'kernel', {
    spaceId: id,
    policyCeiling: config.policyCeiling,
    dial: config.dial,
    humanKeyId: human.id,
  });

  return {
    config,
    gw,
    ledger,
    orders,
    human,
    agent,
    rootKey,
    gatewayKey,
    witness,
    liveRoot,
    shadowRoot,
  };
}
