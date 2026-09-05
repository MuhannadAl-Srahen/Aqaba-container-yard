import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { msUntilNightly, pruneAutos } from '../src/server/nightly';
import { buildMime, encodeSubject } from '../src/server/mailer';
import type { MachineReportRow, Position, TaskDto } from '../src/shared/types';

/**
 * الصيانة الليلية وكشف الإنتاجية ودمج الأسماء — the upkeep trio added in one
 * evening: the clock that fires at 02:30 Amman, the mail that carries the
 * snapshot, the report that reads the «تم» ledger, and the spelling repair
 * for driver names.
 */

describe('the nightly clock', () => {
  it('fires at the coming 02:30 Amman, tonight or tomorrow', () => {
    // 2026-09-05 20:00 UTC = 23:00 Amman → next 02:30 is in 3.5 hours.
    const evening = Date.UTC(2026, 8, 5, 20, 0, 0);
    expect(msUntilNightly(evening)).toBe(3.5 * 60 * 60 * 1000);
    // 2026-09-05 23:00 UTC = 02:00 Amman → half an hour away.
    const nearlyThere = Date.UTC(2026, 8, 5, 23, 0, 0);
    expect(msUntilNightly(nearlyThere)).toBe(30 * 60 * 1000);
    // 00:00 Amman exactly → 2.5 hours; 03:00 Amman → tomorrow's 02:30.
    const midnight = Date.UTC(2026, 8, 5, 21, 0, 0);
    expect(msUntilNightly(midnight)).toBe(2.5 * 60 * 60 * 1000);
    const past = Date.UTC(2026, 8, 6, 0, 0, 0); // 03:00 Amman
    expect(msUntilNightly(past)).toBe(23.5 * 60 * 60 * 1000);
  });

  it('prunes the auto snapshots past the kept depth, oldest first', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'yard-prune-'));
    for (let day = 1; day <= 6; day += 1) {
      const file = path.join(dir, `auto-2026-01-0${String(day)}.db`);
      writeFileSync(file, 'x');
      const at = new Date(2026, 0, day).getTime() / 1000;
      utimesSync(file, at, at);
    }
    writeFileSync(path.join(dir, 'yard-2026-01-01.db'), 'x'); // manual — untouchable
    expect(pruneAutos(dir, 4)).toBe(2);
    expect(pruneAutos(dir, 4)).toBe(0);
  });
});

describe('the backup mail', () => {
  it('builds a MIME message Gmail will carry: subject encoded, file attached', () => {
    const mime = buildMime({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'sender@example.com',
      pass: 'secret',
      to: 'kekeabdo10@gmail.com',
      subject: 'نسخة ساحة العقبة',
      text: 'مرفقة.',
      attachment: { filename: 'auto-x.db', content: Buffer.from('DATA') },
    });
    expect(mime).toContain('To: <kekeabdo10@gmail.com>');
    expect(mime).toContain(`Subject: ${encodeSubject('نسخة ساحة العقبة')}`);
    expect(mime).toContain('filename="auto-x.db"');
    expect(mime).toContain(Buffer.from('DATA').toString('base64'));
    // CRLF line endings throughout — bare LF breaks strict relays.
    expect(mime.includes('\n')).toBe(true);
    expect(mime.split('\r\n').some((line) => line.includes('\n'))).toBe(false);
  });
});

// ---- the API half: productivity report and the name merge ----

let app: FastifyInstance;
let ownerCookie: string;

const at = (bay: number, stack: number): Position => ({ zone: 'B', bay, stack, tier: 'A' });

const cookieOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (header === undefined) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
};

async function call(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
}): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

async function receive(number: string, position: Position, driver: string): Promise<number> {
  const made = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '3210',
      billKind: null,
      notes: '',
      position,
      truck: '500',
      seal: 'JO100001',
      driver,
      weight: '25000',
      handling: 'CRANE',
    },
    cookie: ownerCookie,
  });
  if (made.status !== 201) throw new Error(`gate-in failed: ${JSON.stringify(made.body)}`);
  return (made.body as { id: number }).id;
}

beforeEach(async () => {
  const db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  if (response.statusCode !== 200) throw new Error('setup failed');
  ownerCookie = cookieOf(response.headers as Record<string, unknown>);
});

describe('كشف إنتاجية الآليات', () => {
  it('counts each hand’s finished tasks per machine, auto-closes excluded', async () => {
    // A driver account finishes the entry task; a second task is closed by
    // the EXIT (auto) and must not count as anyone's work.
    const made = await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'سائق الونش', pin: '1111', permissions: [], machine: 'CRANE' },
      cookie: ownerCookie,
    });
    const driverId = (made.body as { id: number }).id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: driverId, pin: '1111' },
    });
    const driverCookie = cookieOf(login.headers as Record<string, unknown>);

    const first = await receive('TGHU1234565', at(1, 1), '');
    await receive('MSKU7654325', at(3, 1), '');
    const queue = await call({ method: 'GET', url: '/api/tasks', cookie: driverCookie });
    const tasks = (queue.body as { tasks: TaskDto[] }).tasks;
    const own = tasks.find((task) => task.containerId === first);
    if (own === undefined) throw new Error('no task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(own.id)}/done`,
      payload: {},
      cookie: driverCookie,
    });
    // The second container leaves — its entry task closes automatically.
    await call({
      method: 'POST',
      url: `/api/containers/${String(first === 1 ? 2 : 1)}/exit`,
      payload: { truck: '600', driver: '' },
      cookie: ownerCookie,
    });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const report = await call({
      method: 'GET',
      url: `/api/reports/machines?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      cookie: ownerCookie,
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: MachineReportRow[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.machine).toBe('CRANE');
    expect(rows[0]?.doer).toBe('سائق الونش');
    expect(rows[0]?.inDone).toBe(1);
    expect(rows[0]?.outDone).toBe(0);
    expect(rows[0]?.total).toBe(1);
    expect(rows[0]?.avgMinutes).toBe(0);
  });
});

describe('دمج أسماء السائقين', () => {
  it('folds stray spellings into the kept one across the whole book', async () => {
    await receive('TGHU1234565', at(1, 1), 'حماد عودة');
    await receive('MSKU7654325', at(3, 1), 'حماد عوده');
    const third = await receive('TRLU5566770', at(5, 1), 'حماد عوده');
    // An exit written under the stray spelling too.
    await call({
      method: 'POST',
      url: `/api/containers/${String(third)}/exit`,
      payload: { truck: '600', driver: 'حماد عوده' },
      cookie: ownerCookie,
    });

    const names = await call({ method: 'GET', url: '/api/drivers/names', cookie: ownerCookie });
    const listed = (names.body as { rows: Array<{ name: string; hauls: number }> }).rows;
    expect(listed.map((row) => row.name)).toContain('حماد عودة');
    expect(listed.map((row) => row.name)).toContain('حماد عوده');

    const merged = await call({
      method: 'POST',
      url: '/api/drivers/merge',
      payload: { keep: 'حماد عودة', drop: ['حماد عوده'] },
      cookie: ownerCookie,
    });
    expect(merged.status).toBe(200);
    expect((merged.body as { hauls: number }).hauls).toBe(3);

    const after = await call({ method: 'GET', url: '/api/drivers/names', cookie: ownerCookie });
    const rows = (after.body as { rows: Array<{ name: string; hauls: number }> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: 'حماد عودة', hauls: 4 });
  });

  it('the merge is the owner’s alone, and keep may not sit among drop', async () => {
    const hire = await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'كاتب', pin: '1234', permissions: ['ACCOUNTING'] },
      cookie: ownerCookie,
    });
    const clerkId = (hire.body as { id: number }).id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: clerkId, pin: '1234' },
    });
    const clerkCookie = cookieOf(login.headers as Record<string, unknown>);
    const refused = await call({
      method: 'POST',
      url: '/api/drivers/merge',
      payload: { keep: 'x', drop: ['y'] },
      cookie: clerkCookie,
    });
    expect(refused.status).toBe(403);

    const slip = await call({
      method: 'POST',
      url: '/api/drivers/merge',
      payload: { keep: 'x', drop: ['x'] },
      cookie: ownerCookie,
    });
    expect(slip.status).toBe(400);
  });
});
