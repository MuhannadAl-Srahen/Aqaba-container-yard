import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import { openDatabase } from '../src/server/db';
import { ASEZA } from '../src/shared/asezaLayout';
import { baySpan } from '../src/shared/address';
import type { ContainerDto, Position } from '../src/shared/types';

/**
 * The owner's training tools. Every one of them touches the database file
 * itself, so these run against a real file on disk — a `:memory:` yard has no
 * path to snapshot and the routes refuse it on purpose.
 */

let app: FastifyInstance;
let cookie = '';
let dir = '';

async function call(input: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
  raw?: Buffer;
  noAuth?: boolean;
}): Promise<{ status: number; body: unknown; bytes: Buffer }> {
  const headers: Record<string, string> = {};
  if (input.noAuth !== true) headers['cookie'] = cookie;
  if (input.raw !== undefined) headers['content-type'] = 'application/octet-stream';
  const sent = input.raw ?? input.payload;
  const response = await app.inject({
    method: input.method,
    url: input.url,
    headers,
    ...(sent === undefined ? {} : { payload: sent as object }),
  });
  let body: unknown = null;
  try {
    body = JSON.parse(response.body) as unknown;
  } catch {
    body = null;
  }
  return { status: response.statusCode, body, bytes: response.rawPayload };
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'yard-tools-'));
  app = buildApp(openDatabase(path.join(dir, 'yard.db')));
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  const header = setup.headers['set-cookie'];
  cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0] ?? '';
});

afterEach(async () => {
  await app.close();
});

const standingCount = async (): Promise<number> => {
  const state = await call({ method: 'GET', url: '/api/state' });
  return (state.body as { containers: unknown[] }).containers.length;
};

/**
 * A ground slot nothing stands on. Bays covered by a spanning 40 are counted
 * through baySpan, not by the bay it is filed under — otherwise the "free"
 * slot could be the half of a 40 nobody listed.
 */
const freeGroundSlot = async (): Promise<Position> => {
  const state = await call({ method: 'GET', url: '/api/state' });
  const taken = new Set<string>();
  for (const container of (state.body as { containers: ContainerDto[] }).containers) {
    const at = container.position;
    if (at === null) continue;
    for (const oddBay of baySpan(at.bay)) taken.add(`${at.zone}|${String(oddBay)}|${String(at.stack)}`);
  }
  for (const zone of ASEZA.zones) {
    for (const bay of zone.bays) {
      for (const stack of zone.stacks[String(bay)] ?? []) {
        if (!taken.has(`${zone.zone}|${String(bay)}|${String(stack)}`)) {
          return { zone: zone.zone, bay, stack, tier: 'A' };
        }
      }
    }
  }
  throw new Error('the demo yard filled 681 slots, which it cannot have');
};

describe('البيانات التجريبية', () => {
  it('fills the yard with containers, bills, hazards and departures', async () => {
    const seeded = await call({ method: 'POST', url: '/api/owner/seed' });
    expect(seeded.status).toBe(200);
    const result = seeded.body as { added: number; departed: number };
    expect(result.added).toBeGreaterThan(30);
    expect(result.departed).toBeGreaterThan(3);

    // Standing is what was added minus what already left again.
    expect(await standingCount()).toBe(result.added - result.departed);

    // The registers have something to show, and the exit sheet has dwell.
    const range = {
      from: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const out = await call({
      method: 'GET',
      url: `/api/reports/gate?type=OUT&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (out.body as { rows: Array<{ dwellDays: number | null; at: string }> }).rows;
    expect(rows.length).toBe(result.departed);
    expect(rows.every((row) => row.dwellDays !== null)).toBe(true);

    // The demo spans real days, not one instant — the daily report needs that.
    const days = new Set(rows.map((row) => row.at.slice(0, 10)));
    expect(days.size).toBeGreaterThan(1);
  });

  it('places every demo container on a legal slot of the official plan', async () => {
    await call({ method: 'POST', url: '/api/owner/seed' });
    const state = await call({ method: 'GET', url: '/api/state' });
    const containers = (state.body as { containers: Array<{ size: number; position: { bay: number } }> })
      .containers;
    // Parity IS the size: nothing may have been placed against that rule.
    for (const container of containers) {
      expect(container.position.bay % 2 === 1 ? 20 : 40).toBe(container.size);
    }
  });

  it('is the owner’s alone', async () => {
    const denied = await call({ method: 'POST', url: '/api/owner/seed', noAuth: true });
    expect(denied.status).toBe(401);
  });
});

describe('حذف البيانات', () => {
  it('needs its own password, set first, and keeps the people', async () => {
    await call({ method: 'POST', url: '/api/owner/seed' });

    // Before a word is set there is nothing to check against, so it refuses.
    const early = await call({
      method: 'POST',
      url: '/api/owner/wipe',
      payload: { password: 'anything' },
    });
    expect(early.status).toBe(409);

    const hired = await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'وسام', pin: '4321', permissions: ['GATE_IN'] },
    });
    expect(hired.status).toBe(201);

    expect(
      (await call({ method: 'POST', url: '/api/owner/wipe-password', payload: { password: 'مسح-2026' } }))
        .status,
    ).toBe(200);
    expect((await call({ method: 'GET', url: '/api/owner/tools' })).body).toMatchObject({
      wipePasswordSet: true,
    });

    // The owner's own login password is NOT the wipe word.
    const wrong = await call({
      method: 'POST',
      url: '/api/owner/wipe',
      payload: { password: 'yard-secret' },
    });
    expect(wrong.status).toBe(403);

    const wiped = await call({
      method: 'POST',
      url: '/api/owner/wipe',
      payload: { password: 'مسح-2026' },
    });
    expect(wiped.status).toBe(200);
    expect(await standingCount()).toBe(0);

    // The staff, the passwords and the session all survive it.
    const staff = await call({ method: 'GET', url: '/api/users' });
    expect((staff.body as { users: unknown[] }).users).toHaveLength(1);

    // And it left a snapshot behind before doing any of it.
    expect(readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('before-wipe'))).toBe(
      true,
    );

    // Card serials restart, because this is a fresh exercise.
    const fresh = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'WIPE0001',
        size: 20,
        customer: 'شركة',
        notes: '',
        position: { zone: 'B', bay: 1, stack: 1, tier: 'A' },
        truck: '500',
        seal: 'JO1',
      },
    });
    expect((fresh.body as { cardIn: number }).cardIn).toBe(1);
  });
});

describe('استرجاع النسخة الاحتياطية', () => {
  it('puts the whole snapshot back: containers, movements and staff', async () => {
    await call({ method: 'POST', url: '/api/owner/seed' });
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'وسام', pin: '4321', permissions: ['GATE_IN'] },
    });
    const before = await standingCount();

    const backup = await call({ method: 'POST', url: '/api/backup' });
    expect(backup.status).toBe(200);
    expect(backup.bytes.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');

    // Wreck the yard thoroughly: clear it and hire somebody else.
    const word = 'مسح-التدريب';
    await call({ method: 'POST', url: '/api/owner/wipe-password', payload: { password: word } });
    expect(
      (await call({ method: 'POST', url: '/api/owner/wipe', payload: { password: word } })).status,
    ).toBe(200);
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'أحمد', pin: '1111', permissions: [] },
    });
    expect(await standingCount()).toBe(0);

    const restored = await call({ method: 'POST', url: '/api/owner/restore', raw: backup.bytes });
    expect(restored.status).toBe(200);
    expect(await standingCount()).toBe(before);

    // The staff list is the backup's, not the one that came after it.
    const staff = await call({ method: 'GET', url: '/api/users' });
    const names = (staff.body as { users: Array<{ name: string }> }).users.map((u) => u.name);
    expect(names).toEqual(['وسام']);

    // The session survived, which is why this request worked at all — the
    // cookie secret is deliberately the one thing not rolled back.
    expect((await call({ method: 'GET', url: '/api/me' })).status).toBe(200);

    // A new container gets an id past the restored ones instead of colliding
    // with one — AUTOINCREMENT reads its next id from sqlite_sequence, which
    // the copy has to reseed by hand.
    const restoredIds = (
      (await call({ method: 'GET', url: '/api/state' })).body as {
        containers: Array<{ id: number }>;
      }
    ).containers.map((container) => container.id);

    const free = await freeGroundSlot();
    const added = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'REST0001',
        size: 20,
        customer: 'شركة',
        notes: '',
        position: free,
        truck: '500',
        seal: 'JO1',
      },
    });
    expect(added.status).toBe(201);

    expect((added.body as { id: number }).id).toBeGreaterThan(Math.max(...restoredIds));
  });

  it('refuses anything that is not a yard backup', async () => {
    const junk = await call({
      method: 'POST',
      url: '/api/owner/restore',
      raw: Buffer.alloc(4096, 7),
    });
    expect(junk.status).toBe(400);
    expect((junk.body as { code: string }).code).toBe('BAD_BACKUP');
  });

  it('is the owner’s alone', async () => {
    const denied = await call({
      method: 'POST',
      url: '/api/owner/restore',
      raw: Buffer.alloc(4096, 7),
      noAuth: true,
    });
    expect(denied.status).toBe(401);
  });
});
