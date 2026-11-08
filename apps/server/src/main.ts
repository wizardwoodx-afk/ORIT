/**
 * SelfImpulse — entry.
 *
 * Boots the harness, then serves the workbench and the channel from one origin so the renderer never
 * needs a second host, a proxy rule, or a credential in the browser.
 */
import { resolve } from 'node:path';
import { Harness } from './app.ts';
import { createChannel } from './http.ts';
import { SIGNATURE } from '@si/voice';

const port = Number(process.env.PORT ?? 4180);
const host = process.env.HOST ?? '0.0.0.0';
const dataRoot = resolve(process.env.SI_DATA ?? '.selfimpulse');

const harness = await Harness.boot({ dataRoot });
const server = createChannel({
  harness,
  roots: [resolve('apps/desktop/dist'), resolve('apps/desktop/src')],
  indexFallback: '/app/index.html',
});

server.listen(port, host, () => {
  console.log(`${SIGNATURE.product} harness on http://${host}:${port}/app/  (data ${dataRoot})`);
  console.log(`${SIGNATURE.mark} ${SIGNATURE.tagline}`);
});

const shutdown = (): void => {
  server.close();
  harness.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
