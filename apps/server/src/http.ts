/**
 * SelfImpulse — channel.
 *
 * The renderer's only door. Every payload is parsed at the boundary (RULES 19) and every read is
 * scoped to one Space; there is no endpoint that spans both. Live updates are a plain event stream,
 * so the UI renders facts in the order the kernel produced them.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Harness } from './app.ts';
import { SPACES, isSpaceId } from './spaces.ts';

const MessageBody = z.object({ space: z.string(), text: z.string().min(1).max(20_000) });
const ApprovalBody = z.object({ space: z.string(), id: z.string().min(1), decision: z.enum(['approve', 'deny']) });

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
  }),
);

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
};

export interface ChannelOptions {
  readonly harness: Harness;
  readonly roots: readonly string[];
  readonly indexFallback: string;
}

export function createChannel(opts: ChannelOptions): Server {
  const { harness, roots } = opts;

  const serveStatic = async (res: ServerResponse, pathname: string): Promise<boolean> => {
    const wanted = pathname === '/' ? opts.indexFallback : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    for (const root of roots) {
      const base = resolve(root);
      const target = join(base, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
      if (!target.startsWith(base + sep)) continue;
      try {
        const info = await stat(target);
        if (!info.isFile()) continue;
        res.writeHead(200, {
          'content-type': TYPES.get(extname(target)) ?? 'application/octet-stream',
          'content-length': info.size,
          'cache-control': 'no-store',
        });
        createReadStream(target).pipe(res);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  };

  const stream = (res: ServerResponse, space: string, cursor: number): void => {
    if (!isSpaceId(space)) {
      json(res, 400, { error: 'unknown space' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': selfimpulse channel open\n\n');
    for (const event of harness.thread(space).list(cursor)) res.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = harness.thread(space).subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const beat = setInterval(() => res.write(': beat\n\n'), 15_000);
    beat.unref?.();
    res.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (pathname === '/api/health') {
        json(res, 200, { ok: true, product: 'SelfImpulse', spaces: ['co-think', 'co-work'] });
        return;
      }

      if (pathname === '/api/spaces') {
        json(res, 200, Object.values(SPACES));
        return;
      }

      if (pathname === '/api/state') {
        const space = url.searchParams.get('space') ?? 'co-think';
        if (!isSpaceId(space)) {
          json(res, 400, { error: 'unknown space' });
          return;
        }
        const since = Number(url.searchParams.get('since') ?? '0');
        json(res, 200, await harness.snapshot(space, Number.isFinite(since) ? since : 0));
        return;
      }

      if (pathname === '/api/message' && req.method === 'POST') {
        const body = MessageBody.safeParse(await readBody(req));
        if (!body.success || !isSpaceId(body.data.space)) {
          json(res, 400, { error: 'invalid message' });
          return;
        }
        const started = harness.runner(body.data.space).start(body.data.text);
        json(res, 202, started);
        return;
      }

      if (pathname === '/api/approval' && req.method === 'POST') {
        const body = ApprovalBody.safeParse(await readBody(req));
        if (!body.success || !isSpaceId(body.data.space)) {
          json(res, 400, { error: 'invalid approval' });
          return;
        }
        const decided = harness.runner(body.data.space).approvals.decide(body.data.id, body.data.decision);
        if (!decided) {
          json(res, 404, { error: 'no such approval' });
          return;
        }
        json(res, 200, decided);
        return;
      }

      if (pathname === '/api/stream') {
        stream(res, url.searchParams.get('space') ?? 'co-think', Number(url.searchParams.get('cursor') ?? '0'));
        return;
      }

      if (await serveStatic(res, pathname)) return;
      json(res, 404, { error: `not found: ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (!res.headersSent) json(res, 500, { error: message });
      else res.end();
    }
  });
}
