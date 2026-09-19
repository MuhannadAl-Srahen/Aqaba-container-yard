import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

  it('packs one bay solid so a full bay can actually be seen', async () => {
    const seeded = await call({ method: 'POST', url: '/api/owner/seed' });
    const label = (seeded.body as { fullBay: string | null }).fullBay;
    expect(label).not.toBeNull();

    // Every ordinary tier of that bay is standing — and nothing left it.
    const state = await call({ method: 'GET', url: '/api/state' });
    const containers = (state.body as { containers: ContainerDto[] }).containers;
    const [zoneName, bayText] = (label ?? '').split('-');
    const bay = Number(bayText);
    const zone = ASEZA.zones.find((z) => z.zone === zoneName);
    const stacks = zone?.stacks[String(bay)] ?? [];
    expect(stacks.length).toBeGreaterThan(2);

    for (const tier of ['A', 'B']) {
      for (const stack of stacks) {
        const found = containers.some((container) => {
          const at = container.position;
          return (
            at !== null &&
            at.zone === zoneName &&
            at.bay === bay &&
            at.stack === stack &&
            at.tier === tier
          );
        });
        expect(found, `${label} stack ${String(stack)} tier ${tier}`).toBe(true);
      }
    }
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

    // It reports what actually went, counted from the tables themselves, and
    // that nothing was left behind. «حذفت ولا ما حذفت» is then a number on the
    // screen rather than an impression of one.
    const cleared = wiped.body as { containers: number; movements: number; left: number };
    expect(cleared.containers).toBeGreaterThan(0);
    expect(cleared.movements).toBeGreaterThan(0);
    expect(cleared.left).toBe(0);

    // The staff, the passwords and the session all survive it.
    const staff = await call({ method: 'GET', url: '/api/users' });
    expect((staff.body as { users: unknown[] }).users).toHaveLength(1);

    // And it left a snapshot behind before doing any of it.
    expect(readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('before-wipe'))).toBe(
      true,
    );

    // Every surface that reads containers must agree the yard is empty — the
    // registers and the log included, since those are what the owner opens to
    // check whether the clearing really happened.
    const period = `from=${new Date(Date.now() - 90 * 86_400_000).toISOString()}&to=${new Date().toISOString()}`;
    for (const url of [
      '/api/reports/standing',
      `/api/reports/gate?type=IN&${period}`,
      `/api/reports/gate?type=OUT&${period}`,
      `/api/reports/log?${period}`,
    ]) {
      const sheet = await call({ method: 'GET', url });
      expect((sheet.body as { rows: unknown[] }).rows, url).toHaveLength(0);
    }

    // Card serials restart, because this is a fresh exercise.
    const fresh = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'WIPE0001',
        size: 20,
        bill: '3210',
        notes: '',
        position: { zone: 'B', bay: 1, stack: 1, tier: 'A' },
        truck: '500',
        seal: 'JO1',
        driver: 'سائق',
        weight: '25000',
        handling: 'CRANE',
      },
    });
    expect((fresh.body as { cardIn: number }).cardIn).toBe(1);
  });
});

describe('التصاريح عبر المسح والاسترجاع', () => {
  /** A permit for whatever demo container is standing first. */
  const issuePermit = async (): Promise<number> => {
    const state = await call({ method: 'GET', url: '/api/state' });
    const first = (state.body as { containers: Array<{ id: number; bill: string }> })
      .containers[0];
    if (first === undefined) throw new Error('no demo container to permit');
    const permit = await call({
      method: 'POST',
      url: '/api/permits',
      payload: { bill: first.bill, items: [{ containerId: first.id, truck: '411' }] },
    });
    if (permit.status !== 201) throw new Error(`permit refused: ${String(permit.status)}`);
    return (permit.body as { id: number }).id;
  };

  const permitCount = async (): Promise<number> => {
    const from = '2000-01-01T00:00:00.000Z';
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const listed = await call({
      method: 'GET',
      url: `/api/permits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    // A struck permit keeps its seat as a «تصريح ملغى» stub; this counts
    // the permits that stand.
    return (listed.body as { rows: Array<{ voided?: boolean }> }).rows.filter(
      (row) => row.voided !== true,
    ).length;
  };

  it('the wipe takes the practice permits and sheets with the practice containers', async () => {
    await call({ method: 'POST', url: '/api/owner/seed' });
    await issuePermit();
    expect(await permitCount()).toBe(1);
    // A practice دفعة rides along and must go the same way.
    const sheet = Buffer.from('#,Unit Nbr,Type,BL Nbr\n1,TGHU1234565,20,B', 'utf8');
    const made = await call({
      method: 'POST',
      url: '/api/batches?name=' + encodeURIComponent('تدريب'),
      raw: sheet,
    });
    expect(made.status).toBe(201);
    const word = 'مسح-التدريب';
    await call({ method: 'POST', url: '/api/owner/wipe-password', payload: { password: word } });
    await call({ method: 'POST', url: '/api/owner/wipe', payload: { password: word } });
    expect(await permitCount()).toBe(0);
    const batches = await call({ method: 'GET', url: '/api/batches' });
    expect((batches.body as { batches: unknown[] }).batches).toHaveLength(0);
  });

  it('a restore brings the permit book back, serial and items alike', async () => {
    await call({ method: 'POST', url: '/api/owner/seed' });
    const id = await issuePermit();
    const backup = await call({ method: 'POST', url: '/api/backup' });
    // Void it after the snapshot; the restore must stand it back up.
    await call({ method: 'DELETE', url: `/api/permits/${String(id)}` });
    expect(await permitCount()).toBe(0);
    const restored = await call({ method: 'POST', url: '/api/owner/restore', raw: backup.bytes });
    expect(restored.status).toBe(200);
    // The confirmation the owner reads accounts for the permit book too.
    expect((restored.body as { permits: number }).permits).toBe(1);
    expect(await permitCount()).toBe(1);
    const paper = await call({ method: 'GET', url: `/api/permits/${String(id)}` });
    expect(paper.status).toBe(200);
    expect((paper.body as { serial: number }).serial).toBe(1);
    expect((paper.body as { items: Array<{ truck: string }> }).items[0]?.truck).toBe('411');
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
        bill: '3210',
        notes: '',
        position: free,
        truck: '500',
        seal: 'JO1',
        driver: 'سائق',
        weight: '25000',
        handling: 'CRANE',
      },
    });
    expect(added.status).toBe(201);

    expect((added.body as { id: number }).id).toBeGreaterThan(Math.max(...restoredIds));
  });

  it('brings the fleet back exactly as the snapshot holds it', async () => {
    // Arrange a distinctive fleet: a truck handed to عادل, one struck out,
    // one registered fresh — the state a restore must reproduce, not the seed.
    const fleetOf = async (): Promise<{
      carriers: Array<{ id: number; name: string }>;
      trucks: Array<{ id: number; carrierId: number; code: string; number: string }>;
    }> =>
      (await call({ method: 'GET', url: '/api/fleet' })).body as {
        carriers: Array<{ id: number; name: string }>;
        trucks: Array<{ id: number; carrierId: number; code: string; number: string }>;
      };

    const before = await fleetOf();
    const bahaa = before.carriers[0];
    const adel = before.carriers[1];
    const moved = before.trucks.find((t) => t.number === '84785');
    const struck = before.trucks.find((t) => t.number === '93896');
    if (bahaa === undefined || adel === undefined || moved === undefined || struck === undefined)
      throw new Error('the seeded fleet is missing');
    await call({
      method: 'PATCH',
      url: `/api/trucks/${String(moved.id)}`,
      payload: { carrierId: adel.id, code: '60', number: '84785', driver: 'عطالله علي' },
    });
    await call({ method: 'DELETE', url: `/api/trucks/${String(struck.id)}` });
    await call({
      method: 'POST',
      url: '/api/trucks',
      payload: { carrierId: adel.id, code: '26', number: '5511', driver: 'سائق عادل' },
    });

    const backup = await call({ method: 'POST', url: '/api/backup' });
    expect(backup.status).toBe(200);

    // Wreck the fleet thoroughly after the snapshot.
    await call({
      method: 'PATCH',
      url: `/api/trucks/${String(moved.id)}`,
      payload: { carrierId: bahaa.id, code: '60', number: '84785', driver: 'غيره' },
    });
    await call({
      method: 'PATCH',
      url: `/api/carriers/${String(adel.id)}`,
      payload: { name: 'عادل معدَّل' },
    });
    await call({ method: 'POST', url: '/api/carriers', payload: { name: 'ناقل دخيل' } });

    const restored = await call({ method: 'POST', url: '/api/owner/restore', raw: backup.bytes });
    expect(restored.status).toBe(200);
    // The reply counts EVERYTHING it put back, fleet included — «تأكد من كل
    // البيانات من استرجاعها» is answered with numbers.
    const counts = restored.body as { carriers: number; trucks: number; movements: number };
    expect(counts.carriers).toBe(2);
    // 27 seeded + 1 registered = 28 rows; the struck-out one rides along too,
    // soft-deleted exactly as the snapshot holds it.
    expect(counts.trucks).toBe(28);

    const after = await fleetOf();
    expect(after.carriers.map((c) => c.name)).toEqual(['بهاء أبو الربع', 'عادل أبو غليون']);
    expect(after.trucks).toHaveLength(27);
    expect(after.trucks.find((t) => t.number === '84785')?.carrierId).toBe(adel.id);
    expect(after.trucks.find((t) => t.number === '5511')?.carrierId).toBe(adel.id);
    expect(after.trucks.find((t) => t.number === '93896')).toBeUndefined();

    // AUTOINCREMENT reseated for trucks too: a new registration must not
    // collide with a restored id.
    const fresh = await call({
      method: 'POST',
      url: '/api/trucks',
      payload: { carrierId: bahaa.id, code: '11', number: '99887', driver: '' },
    });
    expect(fresh.status).toBe(201);
    expect((fresh.body as { id: number }).id).toBeGreaterThan(
      Math.max(...after.trucks.map((t) => t.id)),
    );
  });

  it('restores a backup from before the fleet existed and seeds it', async () => {
    const backup = await call({ method: 'POST', url: '/api/backup' });
    // Rebuild the snapshot as a pre-v18 file: the fleet tables dropped whole.
    const old = path.join(dir, 'old-era.db');
    writeFileSync(old, backup.bytes);
    const surgery = new DatabaseSync(old);
    surgery.exec('PRAGMA journal_mode = DELETE');
    surgery.exec('DROP TABLE trucks; DROP TABLE carriers;');
    surgery.close();

    // Meanwhile the live fleet diverges, so a lazy restore would show through.
    const live = (await call({ method: 'GET', url: '/api/fleet' })).body as {
      carriers: Array<{ id: number }>;
    };
    await call({
      method: 'DELETE',
      url: `/api/trucks/${String(((await call({ method: 'GET', url: '/api/fleet' })).body as { trucks: Array<{ id: number }> }).trucks[0]?.id)}`,
    });
    expect(live.carriers).toHaveLength(2);

    const restored = await call({
      method: 'POST',
      url: '/api/owner/restore',
      raw: readFileSync(old),
    });
    expect(restored.status).toBe(200);
    // The old file never had the tables; migration on the copy seeds the
    // owner's dictated fleet, and THAT is what comes across.
    expect((restored.body as { carriers: number }).carriers).toBe(2);
    expect((restored.body as { trucks: number }).trucks).toBe(27);
    const after = (await call({ method: 'GET', url: '/api/fleet' })).body as {
      trucks: Array<{ number: string }>;
    };
    expect(after.trucks).toHaveLength(27);
    expect(after.trucks.some((t) => t.number === '84785')).toBe(true);
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

describe('تغيير كلمة سر المالك', () => {
  it('changes with the current word, and the doors follow', async () => {
    const changed = await call({
      method: 'POST',
      url: '/api/owner-password',
      payload: { current: 'yard-secret', password: 'yard-new-secret' },
    });
    expect(changed.status).toBe(200);

    // The old word stops opening the door; the new one opens it.
    const oldLogin = await call({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'yard-secret' },
      noAuth: true,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'yard-new-secret' },
      noAuth: true,
    });
    expect(newLogin.status).toBe(200);
  });

  it('refuses a wrong current word, a short new one, and anyone but the owner', async () => {
    const wrong = await call({
      method: 'POST',
      url: '/api/owner-password',
      payload: { current: 'not-it', password: 'yard-new-secret' },
    });
    expect(wrong.status).toBe(403);
    expect((wrong.body as { code: string }).code).toBe('BAD_PASSWORD');

    // The floor of six holds — «0515» alone cannot take the master key.
    const short = await call({
      method: 'POST',
      url: '/api/owner-password',
      payload: { current: 'yard-secret', password: '0515' },
    });
    expect(short.status).toBe(400);

    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'موظف', pin: '4321', permissions: ['REPORTS'] },
    });
    const users = await call({ method: 'GET', url: '/api/users' });
    const clerk = (users.body as { users: Array<{ id: number; name: string }> }).users.find(
      (user) => user.name === 'موظف',
    );
    const owner = cookie;
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: clerk?.id, pin: '4321' },
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie'])?.split(';')[0] ?? '';
    const refused = await call({
      method: 'POST',
      url: '/api/owner-password',
      payload: { current: 'yard-secret', password: 'yard-new-secret' },
    });
    expect(refused.status).toBe(403);
    cookie = owner;
  });
});
