#!/usr/bin/env node
// Zero-dependency static server for the design preview. Serves apps/desktop/src.
// Binds 0.0.0.0 so the sandbox preview proxy can reach it; no host or origin allowlist.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'apps/desktop/src');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8',
  }),
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const wanted = pathname === '/' ? '/preview/' : pathname;
  const file = join(ROOT, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    let target = file;
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
    const body = await stat(target);
    res.writeHead(200, {
      'content-type': TYPES.get(extname(target)) ?? 'application/octet-stream',
      'content-length': body.size,
      'cache-control': 'no-store',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${pathname}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`design preview on http://${HOST}:${PORT}/preview/  (root ${ROOT})`);
});
