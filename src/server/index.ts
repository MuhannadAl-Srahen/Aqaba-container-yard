import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';

import { openDatabase } from './db';
import { buildApp } from './app';
import { startNightly } from './nightly';

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
  void app.register(fastifyStatic, {
    root: distDir,
    // Its own Cache-Control would overwrite ours, so it is switched off and
    // the header is set here per file. The assets are content-hashed and may
    // be kept for a year; the page that NAMES them must not be, or an update
    // would leave a browser asking for a bundle that no longer exists and the
    // office would swear the update never arrived.
    cacheControl: false,
    setHeaders: (response, filePath) => {
      const hashed = filePath.includes('assets') && !filePath.endsWith('index.html');
      response.setHeader(
        'cache-control',
        hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  // Deep links land on the SPA; unknown /api routes stay honest 404s.
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api/') === true) {
      void reply.status(404).send({ code: 'NOT_FOUND' });
      return;
    }
    void reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
}

const port = Number(process.env['PORT'] ?? 8787);
const host = process.env['HOST'] ?? '0.0.0.0';

/**
 * «بانتظار التحميل»: a box whose exit card nobody confirmed loaded leaves the
 * map by itself 24 hours after the card. Checked at start — a server that was
 * down overnight catches up at once — and every five minutes after. A fault
 * is logged and the next round tries again; it never takes the server down.
 */
const LOADING_SWEEP_MS = 5 * 60 * 1000;

function sweepLoading(): void {
  try {
    const loaded = app.sweepLoading();
    if (loaded > 0) console.log(`[loading] ${String(loaded)} cleared after 24 hours`);
  } catch (error: unknown) {
    console.error('[loading]', error);
  }
}

app
  .listen({ port, host })
  .then(() => {
    console.log(`yard-web on http://${host}:${String(port)} — db: ${dataFile}`);
    // النسخة الليلية: 02:30 بتوقيت عمّان، كل ليلة — وإلى البريد إن وُجدت
    // إعدادات SMTP في البيئة.
    startNightly(db);
    sweepLoading();
    setInterval(sweepLoading, LOADING_SWEEP_MS).unref();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
