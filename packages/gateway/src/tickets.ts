import {
  type KeyPair,
  canonicalize,
  publicKeyFromB64,
  randomId,
  sha256hex,
  signString,
  verifyString,
} from '@si/core';

export interface TicketBody {
  id: string;
  grantId: string;
  worker: string;
  tool: string;
  resource: string;
  argsHash: string;
  nonce: string;
  iat: number;
  exp: number;
}
export interface Ticket extends TicketBody {
  sig: string;
}

export const argsHashOf = (args: Record<string, unknown>): string => sha256hex(canonicalize(args));

export class TicketIssuer {
  constructor(
    private readonly key: KeyPair,
    private readonly now: () => number,
    private readonly ttlMs = 30_000,
  ) {}
  issue(p: Omit<TicketBody, 'id' | 'nonce' | 'iat' | 'exp'>): Ticket {
    const body: TicketBody = { ...p, id: randomId(8), nonce: randomId(16), iat: this.now(), exp: this.now() + this.ttlMs };
    return { ...body, sig: signString(this.key.privateKey, canonicalize(body)) };
  }
  get publicB64(): string {
    return this.key.publicB64;
  }
}

/** Runs inside each worker. Tickets are single-use, short-lived, and bound to the exact arguments. */
export class TicketVerifier {
  private readonly seen = new Set<string>();
  constructor(
    private readonly gatewayPubB64: string,
    private readonly workerId: string,
    private readonly now: () => number,
  ) {}
  verify(t: Ticket, tool: string, args: Record<string, unknown>): void {
    const { sig, ...body } = t;
    if (!verifyString(publicKeyFromB64(this.gatewayPubB64), canonicalize(body), sig)) throw new Error('ticket: bad signature');
    if (t.worker !== this.workerId) throw new Error('ticket: wrong worker');
    if (t.tool !== tool) throw new Error('ticket: wrong tool');
    if (this.now() >= t.exp) throw new Error('ticket: expired');
    if (t.argsHash !== argsHashOf(args)) throw new Error('ticket: arguments changed');
    if (this.seen.has(t.nonce)) throw new Error('ticket: replay');
    this.seen.add(t.nonce);
  }
}
