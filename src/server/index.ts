import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';

import { openDatabase } from './db';
import { buildApp } from './app';

/**
 * One process serves everything: the API under /api and, when a build exists,
 * the client from dist/. In development Vite serves the page instead and
 * proxies /api here — same client code, no environment switches in it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../dist');
const dataFile =
  process.env['YARD_DB'] ?? path.resolve(here, '../../data/yard.db');

const db = openDatabase(dataFile);
const app = buildApp(db);

if (existsSync(distDir)) {
  void app.register(fastifyStatic, { root: distDir });
  // Deep links land on the SPA; unknown /api routes stay honest 404s.
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api/') === true) {
      void reply.status(404).send({ code: 'NOT_FOUND' });
      return;
    }
    void reply.sendFile('index.html');
  });
}

const port = Number(process.env['PORT'] ?? 8787);
const host = process.env['HOST'] ?? '0.0.0.0';

app
  .listen({ port, host })
  .then(() => {
    console.log(`yard-web on http://${host}:${String(port)} — db: ${dataFile}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
